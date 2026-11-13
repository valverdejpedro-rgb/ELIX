# Módulo de audio de Radex — ETAPA 3: CAMBIA el audio (volumen/silencio de una app y dispositivo predeterminado).
# Está separado de audio.ps1 (que es solo lectura) a propósito.
# C# compatible con Windows PowerShell 5.1 (C# 5).
#
# Comandos que añade al worker:
#   audio.app          { pids:[int], nivel:int(-1 = no tocar, 0-100), silencio:int(-1 = no tocar, 0/1) } -> { afectadas }
#   audio.dispositivo  { id:string }   (cambia la salida predeterminada, en los 3 roles)  -> { ok }
#   audio.control_ok   {}              (comprueba que el módulo compila y que Windows ofrece IPolicyConfig; no cambia nada)
# La app (tools/audio-control.js) valida los datos y VERIFICA el resultado releyendo el audio.

if (-not ('ElixCtl.ElixAudioCtl' -as [type])) {
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace ElixCtl
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumeratorCom { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator
    {
        [PreserveSig] int Reservado1(int a, int b, IntPtr c);   // EnumAudioEndpoints
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int Reservado2(IntPtr a);
        [PreserveSig] int Reservado3(IntPtr a);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int Reservado1(int a, IntPtr b);          // OpenPropertyStore
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
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
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int Reservado1(IntPtr a);                 // GetDisplayName
        [PreserveSig] int Reservado2(IntPtr a, IntPtr b);       // SetDisplayName
        [PreserveSig] int Reservado3(IntPtr a);                 // GetIconPath
        [PreserveSig] int Reservado4(IntPtr a, IntPtr b);       // SetIconPath
        [PreserveSig] int Reservado5(IntPtr a);                 // GetGroupingParam
        [PreserveSig] int Reservado6(IntPtr a, IntPtr b);       // SetGroupingParam
        [PreserveSig] int Reservado7(IntPtr a);                 // RegisterAudioSessionNotification
        [PreserveSig] int Reservado8(IntPtr a);                 // UnregisterAudioSessionNotification
        [PreserveSig] int Reservado9(IntPtr a);                 // GetSessionIdentifier
        [PreserveSig] int Reservado10(IntPtr a);                // GetSessionInstanceIdentifier
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid eventContext);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    // Interfaz no documentada de Windows (la usan SoundSwitch y similares) para elegir el dispositivo predeterminado.
    [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
    public class PolicyConfigClient { }

    [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPolicyConfig
    {
        [PreserveSig] int Reservado1(IntPtr a, IntPtr b);                 // GetMixFormat
        [PreserveSig] int Reservado2(IntPtr a, int b, IntPtr c);          // GetDeviceFormat
        [PreserveSig] int Reservado3(IntPtr a);                           // ResetDeviceFormat
        [PreserveSig] int Reservado4(IntPtr a, IntPtr b, IntPtr c);       // SetDeviceFormat
        [PreserveSig] int Reservado5(IntPtr a, int b, IntPtr c, IntPtr d); // GetProcessingPeriod
        [PreserveSig] int Reservado6(IntPtr a, IntPtr b);                 // SetProcessingPeriod
        [PreserveSig] int Reservado7(IntPtr a, IntPtr b);                 // GetShareMode
        [PreserveSig] int Reservado8(IntPtr a, IntPtr b);                 // SetShareMode
        [PreserveSig] int Reservado9(IntPtr a, IntPtr b, IntPtr c);       // GetPropertyValue
        [PreserveSig] int Reservado10(IntPtr a, IntPtr b, IntPtr c);      // SetPropertyValue
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int role);
        [PreserveSig] int Reservado11(IntPtr a, int b);                   // SetEndpointVisibility
    }

    public static class ElixAudioCtl
    {
        const int E_RENDER = 0, E_CONSOLE = 0, STATE_ACTIVE = 1, CLSCTX_ALL = 23;
        static Guid IID_Sessions = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

        // Cambia volumen y/o silencio de las sesiones (apps) con esos PID en el dispositivo predeterminado.
        // nivel: -1 = no tocar, 0-100. silencio: -1 = no tocar, 0 = quitar, 1 = silenciar. Devuelve cuántas sesiones tocó.
        public static int SetApp(int[] pids, int nivel, int silencio)
        {
            if (pids == null || pids.Length == 0) return 0;
            if (nivel < -1 || nivel > 100) throw new Exception("Nivel de volumen no válido.");
            if (silencio < -1 || silencio > 1) throw new Exception("Valor de silencio no válido.");
            if (nivel < 0 && silencio < 0) return 0;
            List<int> set = new List<int>(pids);

            IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            IMMDevice dev;
            if (en.GetDefaultAudioEndpoint(E_RENDER, E_CONSOLE, out dev) != 0 || dev == null) throw new Exception("No hay dispositivo de salida predeterminado.");
            object o; Guid gs = IID_Sessions;
            if (dev.Activate(ref gs, CLSCTX_ALL, IntPtr.Zero, out o) != 0 || o == null) throw new Exception("No pude abrir las sesiones de audio.");
            IAudioSessionManager2 mgr = (IAudioSessionManager2)o;
            IAudioSessionEnumerator se;
            if (mgr.GetSessionEnumerator(out se) != 0 || se == null) throw new Exception("No pude listar las sesiones de audio.");
            int n; se.GetCount(out n);
            int tocadas = 0;
            for (int i = 0; i < n; i++)
            {
                object so;
                if (se.GetSession(i, out so) != 0 || so == null) continue;
                IAudioSessionControl2 c2 = so as IAudioSessionControl2;
                ISimpleAudioVolume sv = so as ISimpleAudioVolume;
                if (c2 == null || sv == null) continue;
                int state; c2.GetState(out state);
                if (state == 2) continue;
                uint pid; c2.GetProcessId(out pid);
                bool sys = c2.IsSystemSoundsSession() == 0;
                int key = sys ? 0 : (int)pid;
                if (!set.Contains(key)) continue;
                Guid ctx = Guid.Empty;
                if (nivel >= 0 && sv.SetMasterVolume(nivel / 100.0f, ref ctx) != 0) throw new Exception("Windows rechazó el cambio de volumen.");
                if (silencio >= 0 && sv.SetMute(silencio == 1, ref ctx) != 0) throw new Exception("Windows rechazó el cambio de silencio.");
                tocadas++;
            }
            return tocadas;
        }

        // Cambia el dispositivo de salida predeterminado (consola, multimedia y comunicaciones).
        public static void SetDefault(string id)
        {
            if (string.IsNullOrEmpty(id)) throw new Exception("Falta el dispositivo.");
            IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            IMMDevice d;
            if (en.GetDevice(id, out d) != 0 || d == null) throw new Exception("Windows no encontró ese dispositivo.");
            int st; d.GetState(out st);
            if (st != STATE_ACTIVE) throw new Exception("Ese dispositivo no está activo.");
            IPolicyConfig pc = (IPolicyConfig)new PolicyConfigClient();
            for (int role = 0; role < 3; role++)
            {
                int hr = pc.SetDefaultEndpoint(id, role);
                if (hr != 0) throw new Exception("Windows rechazó el cambio de dispositivo (0x" + hr.ToString("x") + ").");
            }
        }

        // No cambia nada: solo comprueba que Windows ofrece la interfaz para cambiar de dispositivo.
        public static string CheckPolicy()
        {
            try { IPolicyConfig pc = (IPolicyConfig)new PolicyConfigClient(); return pc != null ? "ok" : "no disponible"; }
            catch (Exception e) { return e.Message; }
        }
    }
}
'@
}

$global:ELIX_H['audio.app'] = {
  param($a)
  $pids = @()
  if ($null -ne $a.pids) { foreach ($x in @($a.pids)) { $pids += [int]$x } }
  $n = [ElixCtl.ElixAudioCtl]::SetApp([int[]]$pids, [int]$a.nivel, [int]$a.silencio)
  @{ afectadas = [int]$n }
}

$global:ELIX_H['audio.dispositivo'] = {
  param($a)
  [ElixCtl.ElixAudioCtl]::SetDefault([string]$a.id)
  @{ ok = $true }
}

$global:ELIX_H['audio.control_ok'] = {
  param($a)
  @{ politica = [string][ElixCtl.ElixAudioCtl]::CheckPolicy() }
}
