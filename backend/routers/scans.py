import io
import json
import textwrap
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import paramiko
import winrm
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Server
from schemas import (
    ScanCredentials, ResourceInfo, LogsInfo, ConfigInfo,
    SoftwareInfo, SoftwarePackage, PortEntry, PortsInfo, ScanAllResult,
    StoredScanData,
)

router = APIRouter(prefix="/api/servers/{server_id}/scan", tags=["scans"])

# ---------------------------------------------------------------------------
# PowerShell scripts (Windows / WinRM)
# ---------------------------------------------------------------------------

PS_RESOURCES = r"""
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$mem = Get-CimInstance Win32_OperatingSystem
$memTotalGB = [math]::Round($mem.TotalVisibleMemorySize / 1MB, 2)
$memFreeGB  = [math]::Round($mem.FreePhysicalMemory / 1MB, 2)
$memUsedGB  = [math]::Round($memTotalGB - $memFreeGB, 2)
$memPct     = [math]::Round(($memUsedGB / $memTotalGB) * 100, 1)
$uptimeSecs = (Get-Date) - (gcim Win32_OperatingSystem).LastBootUpTime
$uptimeDays = [math]::Round($uptimeSecs.TotalDays, 2)
$disks = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } |
    Select-Object @{n='drive';e={$_.Name}},
                  @{n='total_gb';e={[math]::Round(($_.Used + $_.Free)/1GB,2)}},
                  @{n='used_gb';e={[math]::Round($_.Used/1GB,2)}},
                  @{n='free_gb';e={[math]::Round($_.Free/1GB,2)}} |
    ConvertTo-Json -Compress
[PSCustomObject]@{
    cpu_percent      = $cpu
    memory_total_gb  = $memTotalGB
    memory_used_gb   = $memUsedGB
    memory_percent   = $memPct
    uptime_days      = $uptimeDays
    disks_json       = $disks
} | ConvertTo-Json -Compress
"""

PS_LOGS = r"""
$logs = Get-EventLog -LogName System -Newest 50 -EntryType Error,Warning |
    Select-Object @{n='time_generated';e={$_.TimeGenerated.ToString('o')}},
                  @{n='source';e={$_.Source}},
                  @{n='event_id';e={$_.EventID}},
                  @{n='event_type';e={$_.EntryType.ToString()}},
                  @{n='message';e={$_.Message -replace '\r?\n',' '}} |
    ConvertTo-Json -Compress
$logs
"""

PS_CONFIG = r"""
$os   = Get-CimInstance Win32_OperatingSystem
$cs   = Get-CimInstance Win32_ComputerSystem
$cpus = (Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name) -join ', '
$svcs = Get-Service | Select-Object @{n='name';e={$_.Name}},
                                    @{n='display_name';e={$_.DisplayName}},
                                    @{n='status';e={$_.Status.ToString()}} |
        ConvertTo-Json -Compress
[PSCustomObject]@{
    os_name           = $os.Caption
    os_version        = $os.Version
    os_architecture   = $os.OSArchitecture
    computer_name     = $cs.Name
    domain            = $cs.Domain
    total_memory_gb   = [math]::Round($cs.TotalPhysicalMemory/1GB, 2)
    processors        = $cpus
    services_json     = $svcs
} | ConvertTo-Json -Compress
"""

PS_PORTS = r"""
$r = @()
try {
    $r += @(Get-NetTCPConnection -State Listen -EA SilentlyContinue | ForEach-Object {
        $pn = try { (Get-Process -Id $_.OwningProcess -EA SilentlyContinue).ProcessName } catch { '' }
        [PSCustomObject]@{ port=$_.LocalPort; protocol='TCP'; state='LISTEN'; process_id=$_.OwningProcess; process=if($pn){$pn}else{''} }
    })
} catch {}
try {
    $r += @(Get-NetUDPEndpoint -EA SilentlyContinue | ForEach-Object {
        $pn = try { (Get-Process -Id $_.OwningProcess -EA SilentlyContinue).ProcessName } catch { '' }
        [PSCustomObject]@{ port=$_.LocalPort; protocol='UDP'; state=''; process_id=$_.OwningProcess; process=if($pn){$pn}else{''} }
    })
} catch {}
$seen = @{}
@($r | Sort-Object port | Where-Object { $k = "$($_.port)-$($_.protocol)"; if (-not $seen[$k]) { $seen[$k]=$true; $true } else { $false } }) | ConvertTo-Json -Compress
"""

PS_SOFTWARE = r"""
$paths = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$seen = @{}
$sw = foreach ($path in $paths) {
    if (Test-Path $path) {
        Get-ItemProperty $path | Where-Object { $_.DisplayName } | ForEach-Object {
            if (-not $seen[$_.DisplayName]) {
                $seen[$_.DisplayName] = $true
                [PSCustomObject]@{
                    name      = $_.DisplayName
                    version   = if ($_.DisplayVersion) { $_.DisplayVersion } else { '' }
                    publisher = if ($_.Publisher) { $_.Publisher } else { '' }
                }
            }
        }
    }
}
($sw | Sort-Object name | ConvertTo-Json -Compress)
"""

# ---------------------------------------------------------------------------
# Python3 remote scripts (Linux / macOS via SSH)
# ---------------------------------------------------------------------------

SSH_RESOURCES = textwrap.dedent("""\
import json, platform, time, subprocess, shutil
S = platform.system()
cpu = None
try:
    if S == 'Darwin':
        o = subprocess.check_output(['top','-l','1','-n','0'], text=True, stderr=subprocess.DEVNULL)
        for l in o.splitlines():
            if 'CPU usage' in l:
                cpu = float(l.split()[2].replace('%',''))
    else:
        def rc():
            with open('/proc/stat') as f: v = list(map(int, f.readline().split()[1:]))
            return v[3], sum(v)
        i1,t1 = rc(); time.sleep(0.5); i2,t2 = rc()
        cpu = round(100*(1-(i2-i1)/(t2-t1)), 1) if t2-t1 else 0.0
except: pass

mt = mu = mp = ud = None
try:
    if S == 'Darwin':
        mt = int(subprocess.check_output(['sysctl','-n','hw.memsize'], text=True).strip())
        ps = int(subprocess.check_output(['sysctl','-n','hw.pagesize'], text=True).strip())
        vm = {}
        for l in subprocess.check_output(['vm_stat'], text=True).splitlines():
            if ':' in l:
                k,v = l.split(':',1); vm[k.strip()] = int(v.strip().rstrip('.'))
        free = (vm.get('Pages free',0) + vm.get('Pages speculative',0)) * ps
        mu = mt - free; mp = round(mu/mt*100,1)
        mt = round(mt/1073741824,2); mu = round(mu/1073741824,2)
    else:
        with open('/proc/meminfo') as f:
            info = {l.split(':')[0]: int(l.split()[1]) for l in f if ':' in l}
        mt = round(info['MemTotal']/1048576, 2)
        av = info.get('MemAvailable', info.get('MemFree',0))
        mu = round((info['MemTotal']-av)/1048576, 2)
        mp = round(mu/mt*100,1) if mt else None
except: pass

try:
    import re, time as tm
    if S == 'Darwin':
        o = subprocess.check_output(['sysctl','-n','kern.boottime'], text=True)
        m = re.search(r'sec = (\\d+)', o)
        if m: ud = round((tm.time()-int(m.group(1)))/86400, 2)
    else:
        with open('/proc/uptime') as f: ud = round(float(f.read().split()[0])/86400, 2)
except: pass

disks = []
try:
    seen = set()
    o = subprocess.check_output(['df','-k'], text=True, stderr=subprocess.DEVNULL)
    skip = {'proc','sys','dev','run','snap','overlay','tmpfs','udev'}
    for l in o.splitlines()[1:]:
        p = l.split()
        if len(p) >= 6:
            mp2 = p[-1]
            if mp2 not in seen and not any(x in mp2 for x in skip):
                try:
                    u = shutil.disk_usage(mp2)
                    if u.total > 1073741824:
                        disks.append({'drive':mp2,'total_gb':round(u.total/1073741824,2),'used_gb':round(u.used/1073741824,2),'free_gb':round(u.free/1073741824,2)})
                        seen.add(mp2)
                except: pass
except: pass

print(json.dumps({'cpu_percent':cpu,'memory_total_gb':mt,'memory_used_gb':mu,'memory_percent':mp,'uptime_days':ud,'disks':disks}))
""")

SSH_LOGS = textwrap.dedent("""\
import json, subprocess, platform
S = platform.system()
entries = []
try:
    if S == 'Darwin':
        o = subprocess.check_output(
            ['log','show','--last','2h','--predicate',
             'eventType == logEvent AND (messageType == 16 OR messageType == 17)',
             '--style','compact'],
            text=True, stderr=subprocess.DEVNULL, timeout=15)
        for l in o.splitlines()[-50:]:
            if l.strip() and not l.startswith('Timestamp'):
                parts = l.split(None, 3)
                entries.append({'time_generated':' '.join(parts[:2]) if len(parts)>1 else l,
                                'source':parts[2] if len(parts)>2 else '',
                                'event_id':0, 'event_type':'Error',
                                'message':parts[3] if len(parts)>3 else l})
    else:
        try:
            o = subprocess.check_output(
                ['journalctl','-n','50','-p','err..warning','--no-pager','--output=json'],
                text=True, stderr=subprocess.DEVNULL, timeout=10)
            for l in o.splitlines():
                try:
                    d = json.loads(l)
                    p = int(d.get('PRIORITY',6))
                    ts = d.get('__REALTIME_TIMESTAMP','')
                    if ts:
                        from datetime import datetime, timezone
                        ts = datetime.fromtimestamp(int(ts)/1e6, tz=timezone.utc).isoformat()
                    entries.append({'time_generated':ts,
                                    'source':d.get('SYSLOG_IDENTIFIER', d.get('_COMM','')),
                                    'event_id':0,
                                    'event_type':'Error' if p<=3 else 'Warning',
                                    'message':d.get('MESSAGE','')})
                except: pass
        except:
            o = subprocess.check_output(
                ['journalctl','-n','50','-p','err..warning','--no-pager'],
                text=True, stderr=subprocess.DEVNULL, timeout=10)
            for l in o.splitlines():
                if l.strip() and not l.startswith('--'):
                    p = l.split(None, 4)
                    entries.append({'time_generated':' '.join(p[:3]) if len(p)>2 else '',
                                    'source':p[3].split('[')[0] if len(p)>3 else '',
                                    'event_id':0, 'event_type':'Error',
                                    'message':p[4] if len(p)>4 else ''})
except Exception as e:
    print(json.dumps({'entries':[], 'error':str(e)})); raise SystemExit
print(json.dumps({'entries':entries}))
""")

SSH_CONFIG = textwrap.dedent("""\
import json, platform, subprocess, socket, os
S = platform.system()
r = {'os_name':None,'os_version':None,'os_architecture':platform.machine(),
     'computer_name':socket.gethostname(),'domain':None,'total_memory_gb':None,
     'processors':[],'installed_features':[],'services':[]}
try:
    if S == 'Darwin':
        r['os_name'] = 'macOS ' + subprocess.check_output(['sw_vers','-productVersion'], text=True).strip()
        r['os_version'] = subprocess.check_output(['sw_vers','-buildVersion'], text=True).strip()
        try: r['computer_name'] = subprocess.check_output(['scutil','--get','ComputerName'], text=True).strip()
        except: pass
        try:
            o = subprocess.check_output(['dsconfigad','-show'], text=True, stderr=subprocess.DEVNULL)
            for l in o.splitlines():
                if 'Active Directory Domain' in l:
                    r['domain'] = l.split('=',1)[1].strip()
        except: pass
    else:
        if os.path.exists('/etc/os-release'):
            with open('/etc/os-release') as f:
                info = {l.split('=')[0]: l.split('=',1)[1].strip().strip('"') for l in f if '=' in l}
            r['os_name'] = info.get('PRETTY_NAME', info.get('NAME','Linux'))
            r['os_version'] = info.get('VERSION', info.get('VERSION_ID',''))
        try: r['domain'] = subprocess.check_output(['hostname','-d'], text=True, stderr=subprocess.DEVNULL).strip() or None
        except: pass
except: pass

try:
    if S == 'Darwin':
        mt = int(subprocess.check_output(['sysctl','-n','hw.memsize'], text=True).strip())
        r['total_memory_gb'] = round(mt/1073741824, 2)
        cpu = subprocess.check_output(['sysctl','-n','machdep.cpu.brand_string'], text=True).strip()
        r['processors'] = [cpu] if cpu else []
    else:
        with open('/proc/meminfo') as f:
            info = {l.split(':')[0]: int(l.split()[1]) for l in f if ':' in l}
        r['total_memory_gb'] = round(info.get('MemTotal',0)/1048576, 2)
        cpus = set()
        with open('/proc/cpuinfo') as f:
            for l in f:
                if 'model name' in l: cpus.add(l.split(':',1)[1].strip())
        r['processors'] = list(cpus)
except: pass

try:
    if S == 'Darwin':
        o = subprocess.check_output(['launchctl','list'], text=True, stderr=subprocess.DEVNULL)
        for l in o.splitlines()[1:101]:
            p = l.split(None, 2)
            if len(p) >= 3 and not p[2].startswith('0x'):
                r['services'].append({'name':p[2],'display_name':p[2],'status':'Running' if p[0]!='-' else 'Stopped'})
    else:
        o = subprocess.check_output(
            ['systemctl','list-units','--type=service','--no-pager','--no-legend','--all'],
            text=True, stderr=subprocess.DEVNULL)
        for l in o.splitlines()[:100]:
            p = l.split(None, 4)
            if len(p) >= 4:
                name = p[0].replace('.service','')
                r['services'].append({'name':name,'display_name':p[4].strip() if len(p)>4 else name,'status':'Running' if p[2]=='running' else p[2]})
except: pass

print(json.dumps(r))
""")

SSH_PORTS = textwrap.dedent("""\
import json, subprocess, platform, re
S = platform.system()
ports = []
try:
    if S == 'Darwin':
        for proto, args, st in [('TCP',['-iTCP','-sTCP:LISTEN'],'LISTEN'),('UDP',['-iUDP'],'')]:
            try:
                o = subprocess.check_output(['lsof']+args+['-n','-P'], text=True, stderr=subprocess.DEVNULL)
                for l in o.splitlines()[1:]:
                    p = l.split()
                    if len(p) >= 9:
                        m = re.search(r':(\\d+)$', p[8])
                        if m:
                            try: ports.append({'port':int(m.group(1)),'protocol':proto,'state':st,'process_id':int(p[1]),'process':p[0]})
                            except: pass
            except: pass
    else:
        for proto, args in [('TCP',['-tlnp']),('UDP',['-ulnp'])]:
            try:
                o = subprocess.check_output(['ss']+args, text=True, stderr=subprocess.DEVNULL)
                for l in o.splitlines()[1:]:
                    p = l.split()
                    if len(p) < 4: continue
                    m = re.search(r':(\\d+)$', p[3])
                    if m:
                        pid, proc = None, ''
                        rest = ' '.join(p[5:]) if len(p) > 5 else ''
                        pm = re.search(r'pid=(\\d+)', rest)
                        nm = re.search(r'"([^"]+)"', rest)
                        if pm: pid = int(pm.group(1))
                        if nm: proc = nm.group(1)
                        ports.append({'port':int(m.group(1)),'protocol':proto,'state':'LISTEN','process_id':pid,'process':proc})
            except: pass
except Exception as e:
    print(json.dumps({'ports':[],'error':str(e)})); raise SystemExit
seen = set()
deduped = []
for p in sorted(ports, key=lambda x: x['port']):
    k = (p['port'], p['protocol'])
    if k not in seen:
        seen.add(k)
        deduped.append(p)
print(json.dumps({'ports': deduped}))
""")

SSH_SOFTWARE = textwrap.dedent("""\
import json, subprocess, platform, os
S = platform.system()
pkgs = []
if S == 'Darwin':
    try:
        import plistlib
        for app in sorted(os.listdir('/Applications')):
            if app.endswith('.app'):
                try:
                    with open(f'/Applications/{app}/Contents/Info.plist','rb') as f:
                        info = plistlib.load(f)
                    pkgs.append({'name':info.get('CFBundleName', app[:-4]),'version':info.get('CFBundleShortVersionString',''),'publisher':info.get('CFBundleIdentifier','')})
                except:
                    pkgs.append({'name':app[:-4],'version':'','publisher':''})
    except: pass
    try:
        o = subprocess.check_output(['brew','list','--versions'], text=True, stderr=subprocess.DEVNULL, timeout=15)
        for l in o.splitlines():
            p = l.split(None,1)
            if p: pkgs.append({'name':p[0],'version':p[1] if len(p)>1 else '','publisher':'Homebrew'})
    except: pass
else:
    try:
        o = subprocess.check_output(['dpkg-query','-W','-f=${Package}\\t${Version}\\t${Maintainer}\\n'], text=True, stderr=subprocess.DEVNULL, timeout=30)
        for l in o.splitlines():
            p = l.split('\\t')
            if p[0]: pkgs.append({'name':p[0],'version':p[1] if len(p)>1 else '','publisher':p[2] if len(p)>2 else ''})
    except:
        try:
            o = subprocess.check_output(['rpm','-qa','--queryformat=%{NAME}\\t%{VERSION}\\t%{VENDOR}\\n'], text=True, stderr=subprocess.DEVNULL, timeout=30)
            for l in o.splitlines():
                p = l.split('\\t')
                if p[0]: pkgs.append({'name':p[0],'version':p[1] if len(p)>1 else '','publisher':p[2] if len(p)>2 else ''})
        except: pass
pkgs.sort(key=lambda x: x['name'].lower())
print(json.dumps({'packages':pkgs}))
""")

# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------

def _mark_scan(db: Session, server: Server, status: str):
    server.scan_status = status
    server.last_scanned = datetime.now(timezone.utc)
    db.commit()


def _persist_scan_data(db: Session, server: Server, updates: dict):
    existing = json.loads(server.scan_data) if server.scan_data else {}
    existing.update(updates)
    server.scan_data = json.dumps(existing)
    db.commit()


def _winrm_session(server: Server, creds: ScanCredentials) -> winrm.Session:
    return winrm.Session(
        server.ip_address or server.hostname,
        auth=(creds.username, creds.password),
        transport=server.winrm_transport,
        server_cert_validation="ignore",
        port=server.winrm_port,
    )


def _run_ps(session: winrm.Session, script: str) -> str:
    result = session.run_ps(script)
    if result.status_code != 0:
        raise RuntimeError(result.std_err.decode(errors="replace").strip())
    return result.std_out.decode(errors="replace").strip()


def _ssh_client(server: Server, creds: ScanCredentials) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kwargs: dict = dict(
        hostname=server.ip_address or server.hostname,
        port=server.ssh_port,
        username=creds.username,
        timeout=30,
    )
    if creds.ssh_key:
        kwargs["pkey"] = paramiko.RSAKey.from_private_key(io.StringIO(creds.ssh_key))
    else:
        kwargs["password"] = creds.password
    client.connect(**kwargs)
    return client


def _run_ssh_python(client: paramiko.SSHClient, script: str) -> str:
    escaped = script.replace("'", "'\\''")
    _stdin, stdout, stderr = client.exec_command(f"python3 -c '{escaped}'", timeout=60)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode(errors="replace").strip()
    err = stderr.read().decode(errors="replace").strip()
    if exit_code != 0:
        raise RuntimeError(err or f"Exit code {exit_code}")
    return out


# ---------------------------------------------------------------------------
# Per-scan helpers (reused by individual endpoints and scan/all)
# ---------------------------------------------------------------------------

def _winrm_resources(server: Server, creds: ScanCredentials) -> ResourceInfo:
    try:
        raw = _run_ps(_winrm_session(server, creds), PS_RESOURCES)
        data = json.loads(raw)
        disks = json.loads(data.get("disks_json") or "[]")
        if isinstance(disks, dict):
            disks = [disks]
        return ResourceInfo(
            cpu_percent=data.get("cpu_percent"),
            memory_total_gb=data.get("memory_total_gb"),
            memory_used_gb=data.get("memory_used_gb"),
            memory_percent=data.get("memory_percent"),
            uptime_days=data.get("uptime_days"),
            disks=disks,
        )
    except Exception as e:
        return ResourceInfo(error=str(e))


def _winrm_logs(server: Server, creds: ScanCredentials) -> LogsInfo:
    try:
        raw = _run_ps(_winrm_session(server, creds), PS_LOGS)
        entries = json.loads(raw) if raw else []
        if isinstance(entries, dict):
            entries = [entries]
        return LogsInfo(entries=entries)
    except Exception as e:
        return LogsInfo(error=str(e))


def _winrm_config(server: Server, creds: ScanCredentials) -> ConfigInfo:
    try:
        raw = _run_ps(_winrm_session(server, creds), PS_CONFIG)
        data = json.loads(raw)
        services = json.loads(data.get("services_json") or "[]")
        if isinstance(services, dict):
            services = [services]
        processors = [p.strip() for p in (data.get("processors") or "").split(",") if p.strip()]
        return ConfigInfo(
            os_name=data.get("os_name"),
            os_version=data.get("os_version"),
            os_architecture=data.get("os_architecture"),
            computer_name=data.get("computer_name"),
            domain=data.get("domain"),
            total_memory_gb=data.get("total_memory_gb"),
            processors=processors,
            services=services,
        )
    except Exception as e:
        return ConfigInfo(error=str(e))


def _winrm_software(server: Server, creds: ScanCredentials) -> SoftwareInfo:
    try:
        raw = _run_ps(_winrm_session(server, creds), PS_SOFTWARE)
        pkgs = json.loads(raw) if raw else []
        if isinstance(pkgs, dict):
            pkgs = [pkgs]
        return SoftwareInfo(packages=[SoftwarePackage(**p) for p in pkgs if p.get("name")])
    except Exception as e:
        return SoftwareInfo(error=str(e))


def _ssh_resources(client: paramiko.SSHClient) -> ResourceInfo:
    try:
        data = json.loads(_run_ssh_python(client, SSH_RESOURCES))
        return ResourceInfo(**data)
    except Exception as e:
        return ResourceInfo(error=str(e))


def _ssh_logs(client: paramiko.SSHClient) -> LogsInfo:
    try:
        data = json.loads(_run_ssh_python(client, SSH_LOGS))
        return LogsInfo(**data)
    except Exception as e:
        return LogsInfo(error=str(e))


def _ssh_config(client: paramiko.SSHClient) -> ConfigInfo:
    try:
        data = json.loads(_run_ssh_python(client, SSH_CONFIG))
        return ConfigInfo(**data)
    except Exception as e:
        return ConfigInfo(error=str(e))


def _ssh_software(client: paramiko.SSHClient) -> SoftwareInfo:
    try:
        data = json.loads(_run_ssh_python(client, SSH_SOFTWARE))
        pkgs = data.get("packages", [])
        return SoftwareInfo(packages=[SoftwarePackage(**p) for p in pkgs if p.get("name")])
    except Exception as e:
        return SoftwareInfo(error=str(e))


def _winrm_ports(server: Server, creds: ScanCredentials) -> PortsInfo:
    try:
        raw = _run_ps(_winrm_session(server, creds), PS_PORTS)
        items = json.loads(raw) if raw and raw != "null" else []
        if isinstance(items, dict):
            items = [items]
        return PortsInfo(ports=[PortEntry(**p) for p in items if p.get("port")])
    except Exception as e:
        return PortsInfo(error=str(e))


def _ssh_ports(client: paramiko.SSHClient) -> PortsInfo:
    try:
        data = json.loads(_run_ssh_python(client, SSH_PORTS))
        if "error" in data and not data.get("ports"):
            return PortsInfo(error=data["error"])
        return PortsInfo(ports=[PortEntry(**p) for p in data.get("ports", [])])
    except Exception as e:
        return PortsInfo(error=str(e))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def _get_server(server_id: int, db: Session) -> Server:
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


@router.post("/all", response_model=ScanAllResult)
def scan_all(server_id: int, creds: ScanCredentials, db: Session = Depends(get_db)):
    server = _get_server(server_id, db)

    if server.connection_type == "ssh":
        try:
            client = _ssh_client(server, creds)
            with ThreadPoolExecutor(max_workers=5) as pool:
                f_res  = pool.submit(_ssh_resources, client)
                f_logs = pool.submit(_ssh_logs,      client)
                f_conf = pool.submit(_ssh_config,    client)
                f_sw   = pool.submit(_ssh_software,  client)
                f_pts  = pool.submit(_ssh_ports,     client)
                resources     = f_res.result()
                logs          = f_logs.result()
                configuration = f_conf.result()
                software      = f_sw.result()
                ports         = f_pts.result()
            client.close()
        except Exception as e:
            _mark_scan(db, server, "error")
            err = str(e)
            return ScanAllResult(
                resources=ResourceInfo(error=err),
                logs=LogsInfo(error=err),
                configuration=ConfigInfo(error=err),
                software=SoftwareInfo(error=err),
                ports=PortsInfo(error=err),
            )
    else:
        # WinRM: each helper opens its own HTTP session (WinRM is stateless)
        with ThreadPoolExecutor(max_workers=5) as pool:
            f_res  = pool.submit(_winrm_resources, server, creds)
            f_logs = pool.submit(_winrm_logs,      server, creds)
            f_conf = pool.submit(_winrm_config,    server, creds)
            f_sw   = pool.submit(_winrm_software,  server, creds)
            f_pts  = pool.submit(_winrm_ports,     server, creds)
            resources     = f_res.result()
            logs          = f_logs.result()
            configuration = f_conf.result()
            software      = f_sw.result()
            ports         = f_pts.result()

    any_error = any(x.error for x in [resources, logs, configuration, software, ports])
    _mark_scan(db, server, "error" if any_error else "success")
    result = ScanAllResult(
        resources=resources,
        logs=logs,
        configuration=configuration,
        software=software,
        ports=ports,
    )
    _persist_scan_data(db, server, result.model_dump())
    return result


@router.get("/results", response_model=StoredScanData | None)
def get_scan_results(server_id: int, db: Session = Depends(get_db)):
    server = _get_server(server_id, db)
    if not server.scan_data:
        return None
    data = json.loads(server.scan_data)
    data["last_scanned"] = server.last_scanned
    return StoredScanData(**data)


@router.post("/resources", response_model=ResourceInfo)
def scan_resources(server_id: int, creds: ScanCredentials, db: Session = Depends(get_db)):
    server = _get_server(server_id, db)
    if server.connection_type == "ssh":
        client = _ssh_client(server, creds)
        result = _ssh_resources(client)
        client.close()
    else:
        result = _winrm_resources(server, creds)
    _mark_scan(db, server, "error" if result.error else "success")
    _persist_scan_data(db, server, {"resources": result.model_dump()})
    return result


@router.post("/logs", response_model=LogsInfo)
def scan_logs(server_id: int, creds: ScanCredentials, db: Session = Depends(get_db)):
    server = _get_server(server_id, db)
    if server.connection_type == "ssh":
        client = _ssh_client(server, creds)
        result = _ssh_logs(client)
        client.close()
    else:
        result = _winrm_logs(server, creds)
    _mark_scan(db, server, "error" if result.error else "success")
    _persist_scan_data(db, server, {"logs": result.model_dump()})
    return result


@router.post("/configuration", response_model=ConfigInfo)
def scan_configuration(server_id: int, creds: ScanCredentials, db: Session = Depends(get_db)):
    server = _get_server(server_id, db)
    if server.connection_type == "ssh":
        client = _ssh_client(server, creds)
        result = _ssh_config(client)
        client.close()
    else:
        result = _winrm_config(server, creds)
    _mark_scan(db, server, "error" if result.error else "success")
    _persist_scan_data(db, server, {"configuration": result.model_dump()})
    return result


@router.post("/software", response_model=SoftwareInfo)
def scan_software(server_id: int, creds: ScanCredentials, db: Session = Depends(get_db)):
    server = _get_server(server_id, db)
    if server.connection_type == "ssh":
        client = _ssh_client(server, creds)
        result = _ssh_software(client)
        client.close()
    else:
        result = _winrm_software(server, creds)
    _mark_scan(db, server, "error" if result.error else "success")
    _persist_scan_data(db, server, {"software": result.model_dump()})
    return result


@router.post("/ports", response_model=PortsInfo)
def scan_ports(server_id: int, creds: ScanCredentials, db: Session = Depends(get_db)):
    server = _get_server(server_id, db)
    if server.connection_type == "ssh":
        client = _ssh_client(server, creds)
        result = _ssh_ports(client)
        client.close()
    else:
        result = _winrm_ports(server, creds)
    _mark_scan(db, server, "error" if result.error else "success")
    _persist_scan_data(db, server, {"ports": result.model_dump()})
    return result
