# Módulo de audio de Radex — ETAPA 2: SOLO LECTURA (no cambia nada en el PC).
# Usa la API COM de audio de Windows (Core Audio) compilada con Add-Type.
# C# compatible con Windows PowerShell 5.1 (C# 5): sin ?., sin interpolación $"", sin "=>".
#
# Seguridad: los métodos de COM que cambian cosas (volumen, silencio) se declaran como "Reservado"
# y NUNCA se llaman. Este módulo solo usa Get*, Enum* y OpenPropertyStore (lectura).
#
# Comando que añade al worker:
#   audio.leer  { direccion: 'salida'|'entrada' }  ->  { json: "<texto JSON>" }

if (-not ('ElixCore.ElixAudio' -as [type])) {
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace ElixCore
{
    [StructLayout(LayoutKind.Sequential)]
    public struct PropertyKey { public Guid fmtid; public uint pid; }

    [StructLayout(LayoutKind.Explicit)]
    public struct PropVariant
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr ptr;
        [FieldOffset(12)] public int relleno; // en 32 bits completa los 16 bytes de PROPVARIANT
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int Reservado1(IntPtr a);
        [PreserveSig] int Reservado2(IntPtr a);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int Reservado1(IntPtr a, IntPtr b);
        [PreserveSig] int Commit();
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolume
    {
        [PreserveSig] int Reservado1(IntPtr a);                 // RegisterControlChangeNotify
        [PreserveSig] int Reservado2(IntPtr a);                 // UnregisterControlChangeNotify
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int Reservado3(float a, IntPtr b);        // SetMasterVolumeLevel (NO se usa)
        [PreserveSig] int Reservado4(float a, IntPtr b);        // SetMasterVolumeLevelScalar (NO se usa)
        [PreserveSig] int GetMasterVolumeLevel(out float db);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int Reservado5(uint a, float b, IntPtr c); // SetChannelVolumeLevel (NO se usa)
        [PreserveSig] int Reservado6(uint a, float b, IntPtr c); // SetChannelVolumeLevelScalar (NO se usa)
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float db);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int Reservado7([MarshalAs(UnmanagedType.Bool)] bool a, IntPtr b); // SetMute (NO se usa)
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioMeterInformation
    {
        [PreserveSig] int GetPeakValue(out float peak);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionManager2
    {
        [PreserveSig] int Reservado1(IntPtr a, uint b, IntPtr c); // GetAudioSessionControl
        [PreserveSig] int Reservado2(IntPtr a, uint b, IntPtr c); // GetSimpleAudioVolume
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionControl2
    {
        // --- IAudioSessionControl (base) ---
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int Reservado1(IntPtr a, IntPtr b);   // SetDisplayName
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int Reservado2(IntPtr a, IntPtr b);   // SetIconPath
        [PreserveSig] int GetGroupingParam(out Guid g);
        [PreserveSig] int Reservado3(IntPtr a, IntPtr b);   // SetGroupingParam
        [PreserveSig] int Reservado4(IntPtr a);             // RegisterAudioSessionNotification
        [PreserveSig] int Reservado5(IntPtr a);             // UnregisterAudioSessionNotification
        // --- IAudioSessionControl2 ---
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ISimpleAudioVolume
    {
        [PreserveSig] int Reservado1(float a, IntPtr b);    // SetMasterVolume (NO se usa)
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int Reservado2([MarshalAs(UnmanagedType.Bool)] bool a, IntPtr b); // SetMute (NO se usa)
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    public static class ElixAudio
    {
        const int E_RENDER = 0, E_CAPTURE = 1, E_CONSOLE = 0;
        const int STATE_ACTIVE = 1;
        const int CLSCTX_ALL = 23;
        static Guid IID_Volume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        static Guid IID_Meter = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");
        static Guid IID_Sessions = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

        // Se crea por CLSID (no con "new Clase()"): si dos módulos declaran la misma clase COM, Windows las confunde.
        static object Crear(string clsid) { return Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid(clsid))); }

        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant pv);

        static string Esc(string s)
        {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder();
            foreach (char c in s)
            {
                if (c == '\\') sb.Append("\\\\");
                else if (c == '"') sb.Append("\\\"");
                else if (c < 32) sb.Append("\\u" + ((int)c).ToString("x4"));
                else sb.Append(c);
            }
            return sb.ToString();
        }
        static string Q(string s) { return "\"" + Esc(s) + "\""; }
        static string B(bool b) { return b ? "true" : "false"; }
        static string N(double d) { return d.ToString("0.###", CultureInfo.InvariantCulture); }
        static int Pct(float f) { return (int)Math.Round(f * 100.0); }

        static string FriendlyName(IMMDevice dev)
        {
            IPropertyStore ps = null;
            try
            {
                if (dev.OpenPropertyStore(0, out ps) != 0 || ps == null) return "";
                PropertyKey key = new PropertyKey();
                key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"); // PKEY_Device_FriendlyName
                key.pid = 14;
                PropVariant pv;
                if (ps.GetValue(ref key, out pv) != 0) return "";
                string name = "";
                if (pv.vt == 31 && pv.ptr != IntPtr.Zero) name = Marshal.PtrToStringUni(pv.ptr); // VT_LPWSTR
                PropVariantClear(ref pv);
                return name ?? "";
            }
            catch { return ""; }
            finally { if (ps != null) { try { Marshal.ReleaseComObject(ps); } catch { } } }
        }

        static string ProcName(uint pid)
        {
            if (pid == 0) return "";
            try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
        }

        class Meter { public IAudioMeterInformation M; public float Max; }

        static void Sample(List<Meter> meters)
        {
            // 6 lecturas durante ~0,3 s: un solo instante podría caer en un silencio entre sonidos
            for (int i = 0; i < 6; i++)
            {
                foreach (Meter m in meters)
                {
                    float p;
                    if (m.M != null && m.M.GetPeakValue(out p) == 0 && p > m.Max) m.Max = p;
                }
                if (i < 5) Thread.Sleep(50);
            }
        }

        // Devuelve un texto JSON con: dispositivos, y (para el dispositivo predeterminado) las apps con sesión de audio.
        public static string Snapshot(bool captura)
        {
            int flow = captura ? E_CAPTURE : E_RENDER;
            IMMDeviceEnumerator en = (IMMDeviceEnumerator)Crear("BCDE0395-E52F-467C-8E3D-C4579291692E");
            IMMDevice defDev = null;
            string defId = "";
            if (en.GetDefaultAudioEndpoint(flow, E_CONSOLE, out defDev) == 0 && defDev != null)
            {
                defDev.GetId(out defId);
            }

            IMMDeviceCollection col;
            int hr = en.EnumAudioEndpoints(flow, STATE_ACTIVE, out col);
            if (hr != 0 || col == null) throw new Exception("No pude listar los dispositivos de audio (0x" + hr.ToString("x") + ").");
            uint count; col.GetCount(out count);

            List<string> devJson = new List<string>();
            List<Meter> meters = new List<Meter>();
            List<int> devMeterIdx = new List<int>();

            // Primera pasada: volumen, silencio y medidor de cada dispositivo
            List<string[]> devInfo = new List<string[]>();
            for (uint i = 0; i < count; i++)
            {
                IMMDevice d; if (col.Item(i, out d) != 0 || d == null) continue;
                string id; d.GetId(out id);
                string name = FriendlyName(d);
                float vol = -1; bool mute = false; bool haveVol = false;
                object o;
                Guid gv = IID_Volume;
                if (d.Activate(ref gv, CLSCTX_ALL, IntPtr.Zero, out o) == 0 && o != null)
                {
                    IAudioEndpointVolume ev = (IAudioEndpointVolume)o;
                    if (ev.GetMasterVolumeLevelScalar(out vol) == 0) haveVol = true;
                    ev.GetMute(out mute);
                }
                Meter mt = new Meter();
                Guid gm = IID_Meter;
                if (d.Activate(ref gm, CLSCTX_ALL, IntPtr.Zero, out o) == 0 && o != null) mt.M = (IAudioMeterInformation)o;
                meters.Add(mt);
                devMeterIdx.Add(meters.Count - 1);
                devInfo.Add(new string[] { id, name, haveVol ? Pct(vol).ToString() : "null", B(mute), (id == defId) ? "1" : "0" });
            }

            // Sesiones (apps) del dispositivo predeterminado
            List<string[]> sesInfo = new List<string[]>();
            List<int> sesMeterIdx = new List<int>();
            if (defDev != null)
            {
                object o; Guid gs = IID_Sessions;
                if (defDev.Activate(ref gs, CLSCTX_ALL, IntPtr.Zero, out o) == 0 && o != null)
                {
                    IAudioSessionManager2 mgr = (IAudioSessionManager2)o;
                    IAudioSessionEnumerator se;
                    if (mgr.GetSessionEnumerator(out se) == 0 && se != null)
                    {
                        int n; se.GetCount(out n);
                        for (int i = 0; i < n; i++)
                        {
                            object so; if (se.GetSession(i, out so) != 0 || so == null) continue;
                            IAudioSessionControl2 c2 = so as IAudioSessionControl2;
                            if (c2 == null) continue;
                            int state; c2.GetState(out state); // 0 inactiva, 1 activa, 2 expirada
                            if (state == 2) continue;
                            uint pid; c2.GetProcessId(out pid);
                            bool sys = c2.IsSystemSoundsSession() == 0;
                            string disp; c2.GetDisplayName(out disp);
                            string proc = ProcName(pid);
                            string nombre = sys ? "Sonidos del sistema" : (!string.IsNullOrEmpty(disp) && disp[0] != '@' ? disp : proc);
                            if (string.IsNullOrEmpty(nombre)) nombre = "(desconocida)";
                            float av = -1; bool am = false;
                            ISimpleAudioVolume sv = so as ISimpleAudioVolume;
                            if (sv != null) { sv.GetMasterVolume(out av); sv.GetMute(out am); }
                            Meter mt = new Meter();
                            mt.M = so as IAudioMeterInformation;
                            meters.Add(mt);
                            sesMeterIdx.Add(meters.Count - 1);
                            sesInfo.Add(new string[] { nombre, proc, pid.ToString(), (av >= 0) ? Pct(av).ToString() : "null", B(am), state.ToString() });
                        }
                    }
                }
            }

            Sample(meters);

            StringBuilder sb = new StringBuilder();
            sb.Append("{\"direccion\":").Append(Q(captura ? "entrada" : "salida")).Append(",\"dispositivos\":[");
            for (int i = 0; i < devInfo.Count; i++)
            {
                if (i > 0) sb.Append(",");
                string[] x = devInfo[i];
                sb.Append("{\"id\":").Append(Q(x[0])).Append(",\"nombre\":").Append(Q(x[1]))
                  .Append(",\"volumen\":").Append(x[2]).Append(",\"silenciado\":").Append(x[3])
                  .Append(",\"predeterminado\":").Append(x[4] == "1" ? "true" : "false")
                  .Append(",\"pico\":").Append(Pct(meters[devMeterIdx[i]].Max)).Append("}");
            }
            sb.Append("],\"apps\":[");
            for (int i = 0; i < sesInfo.Count; i++)
            {
                if (i > 0) sb.Append(",");
                string[] x = sesInfo[i];
                sb.Append("{\"nombre\":").Append(Q(x[0])).Append(",\"proceso\":").Append(Q(x[1]))
                  .Append(",\"pid\":").Append(x[2]).Append(",\"volumen\":").Append(x[3])
                  .Append(",\"silenciada\":").Append(x[4]).Append(",\"estado\":").Append(x[5])
                  .Append(",\"pico\":").Append(Pct(meters[sesMeterIdx[i]].Max)).Append("}");
            }
            sb.Append("]}");
            return sb.ToString();
        }
    }
}
'@
}

# ---- Comando del worker ----
$global:ELIX_H['audio.leer'] = {
  param($a)
  $captura = ([string]$a.direccion -eq 'entrada')
  @{ json = [ElixCore.ElixAudio]::Snapshot($captura) }
}
