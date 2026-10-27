using System;
using System.IO;
using System.Runtime.InteropServices;

// Arn0 Home control — variante para TQ65QN90DATXXC (Tizen 9, T-PTMDDEUC-0090-2130.0).
// Adaptación de native/Control.cs del repo arn0-tv con las mismas garantías:
// guards exactos, read-back tras cada escritura, apply exige estado original,
// restore automático si apply falla. Baseline embebido (capturado 2026-10-27,
// ver backup-local/baseline.json) para no depender de System.Text.Json.

internal static class Control
{
    private const string Target = "Arn0Lnchr0.Launcher";
    private const string TargetPackage = "Arn0Lnchr0";
    private const string MainOperation = "http://tizen.org/appcontrol/operation/main";
    private const string AutoKey = "db/menu/smart_hub/ontvsetting/auto_start";
    private const string HomeKey = "db/appfw/home_appid";
    private const string FirmwareGuard = "T-PTMDDEUC-0090-2130.0";

    // Baseline capturado de ESTA TV antes de cualquier cambio.
    private const string OrigHome = "com.samsung.tv.csfs";
    private const string OrigStartup = "com.samsung.tv.csfs";
    private const string OrigBootingBackup = "com.samsung.tv.csfs";
    private const string OrigFirstScreen = "com.samsung.tv.csfs";
    private const int OrigAutostart = 1;

    [DllImport("libbundle.so.0")] private static extern IntPtr bundle_create();
    [DllImport("libbundle.so.0")] private static extern void bundle_free(IntPtr bundle);
    [DllImport("libaul.so.0")] private static extern int aul_svc_set_operation(IntPtr bundle, string operation);
    [DllImport("libaul.so.0")] private static extern int aul_get_default_app(IntPtr bundle, out IntPtr app);
    [DllImport("libapp-context-manager-common.so")] private static extern byte util_is_appbooting_supported_webapp_byappid(string appId);
    [DllImport("libcapi-appfw-app-operation-tv.so.0")] private static extern int app_operation_set_current_app(string operation, string appId);
    [DllImport("libvconf.so.0")] private static extern IntPtr vconf_get_str(string key);
    [DllImport("libvconf.so.0")] private static extern int vconf_set_str(string key, string value);
    [DllImport("libvconf.so.0")] private static extern int vconf_get_int(string key, out int value);
    [DllImport("libvconf.so.0")] private static extern int vconf_set_int(string key, int value);
    [DllImport("libc")] private static extern uint getuid();
    [DllImport("libc")] private static extern void free(IntPtr ptr);

    private static void Guard()
    {
        if (IntPtr.Size != 4) throw new Exception("Expected 32-bit process; stopped");
        if (getuid() != 901) throw new Exception("Expected SDK UID 901; stopped");
        string prd = File.ReadAllText("/etc/prd_info.ini");
        if (prd.IndexOf(FirmwareGuard, StringComparison.Ordinal) < 0)
            throw new Exception("Firmware guard mismatch; expected " + FirmwareGuard + "; stopped");
    }

    private static string ReadString(string key)
    {
        IntPtr ptr = vconf_get_str(key);
        if (ptr == IntPtr.Zero) throw new Exception("Cannot read " + key);
        try { return Marshal.PtrToStringAnsi(ptr); }
        finally { free(ptr); }
    }

    private static string ReadHome()
    {
        IntPtr bundle = bundle_create();
        if (bundle == IntPtr.Zero) throw new Exception("bundle_create failed");
        try
        {
            if (aul_svc_set_operation(bundle, MainOperation) != 0)
                throw new Exception("Cannot set Home query operation");
            IntPtr app;
            if (aul_get_default_app(bundle, out app) != 0 || app == IntPtr.Zero)
                throw new Exception("Cannot read Home operation");
            try { return Marshal.PtrToStringAnsi(app); }
            finally { free(app); }
        }
        finally { bundle_free(bundle); }
    }

    private static void CheckOriginalState()
    {
        string home = ReadHome(), startup = ReadString("db/appfw/startup_appid"),
               booting = ReadString("db/appfw/booting_appid_backup"),
               first = ReadString("db/first_screen/type");
        int autostart;
        if (vconf_get_int(AutoKey, out autostart) != 0) throw new Exception("Cannot read " + AutoKey);
        if (home != OrigHome) throw new Exception("Home operation differs from saved original: " + home);
        if (startup != OrigStartup) throw new Exception("startup_appid differs from original: " + startup);
        if (booting != OrigBootingBackup) throw new Exception("booting_appid_backup differs from original: " + booting);
        if (first != OrigFirstScreen) throw new Exception("first_screen/type differs from original: " + first);
        if (autostart != OrigAutostart) throw new Exception("auto_start differs from original");
    }

    private static void CheckRestorableState()
    {
        string home = ReadHome(), startup = ReadString("db/appfw/startup_appid"),
               booting = ReadString("db/appfw/booting_appid_backup"),
               first = ReadString("db/first_screen/type");
        int autostart;
        vconf_get_int(AutoKey, out autostart);
        if (home != OrigHome && home != Target) throw new Exception("Home operation changed unexpectedly; refusing restore: " + home);
        if (startup != OrigStartup && startup != Target) throw new Exception("startup_appid changed unexpectedly; refusing restore: " + startup);
        if (booting != OrigBootingBackup && booting != Target) throw new Exception("booting_appid_backup changed unexpectedly; refusing restore: " + booting);
        if (first != OrigFirstScreen && first != Target) throw new Exception("first_screen/type changed unexpectedly; refusing restore: " + first);
        if (autostart != OrigAutostart) throw new Exception("auto_start changed unexpectedly; refusing restore");
    }

    private static void SetString(string key, string value)
    {
        if (vconf_set_str(key, value) != 0 || ReadString(key) != value)
            throw new Exception("Write/readback failed: " + key);
    }

    private static void SetInt(string key, int value)
    {
        int actual;
        if (vconf_set_int(key, value) != 0 || vconf_get_int(key, out actual) != 0 || actual != value)
            throw new Exception("Write/readback failed: " + key);
    }

    private static void SetHome(string appId)
    {
        if (app_operation_set_current_app(MainOperation, appId) != 0 || ReadHome() != appId)
            throw new Exception("Home operation write/readback failed");
    }

    private static void RestoreOriginal()
    {
        SetHome(OrigHome);
        SetString(HomeKey, OrigHome);
        SetString("db/appfw/startup_appid", OrigStartup);
        SetString("db/appfw/booting_appid_backup", OrigBootingBackup);
        SetString("db/first_screen/type", OrigFirstScreen);
        SetInt(AutoKey, OrigAutostart);
    }

    private static void Apply()
    {
        CheckOriginalState();
        string appDir = "/opt/usr/home/owner/apps_rw/" + TargetPackage;
        if (!Directory.Exists(appDir)) throw new Exception("Expected launcher package directory missing");
        if (util_is_appbooting_supported_webapp_byappid(Target) == 0)
            throw new Exception("TV says launcher is not eligible for boot; stopped");

        try
        {
            SetHome(Target);
            SetString(HomeKey, Target);
            SetString("db/appfw/startup_appid", OrigStartup);      // se reescribe sin cambios
            SetString("db/appfw/booting_appid_backup", OrigBootingBackup);
            SetString("db/first_screen/type", OrigFirstScreen);    // se reescribe sin cambios
            SetInt(AutoKey, OrigAutostart);                        // se reescribe sin cambios
            string home = ReadHome(), homeKey = ReadString(HomeKey);
            if (home != Target || homeKey != Target)
                throw new Exception("Applied values failed verification");
            Console.WriteLine("ARN0_APPLIED=Home=" + home + ";home_appid=" + homeKey + ";startup=" + OrigStartup + ";autostart=" + OrigAutostart);
        }
        catch
        {
            try
            {
                RestoreOriginal();
                Console.Error.WriteLine("Original values restored and verified after apply failure");
            }
            catch (Exception restoreError)
            {
                Console.Error.WriteLine("URGENT: automatic restore failed: " + restoreError);
            }
            throw;
        }
    }

    private static int Main(string[] args)
    {
        try
        {
            Guard();
            string cmd = args.Length > 0 ? args[0] : "";
            if (cmd == "query")
            {
                Console.WriteLine("home=" + ReadHome());
                Console.WriteLine(HomeKey + "=" + ReadString(HomeKey));
                Console.WriteLine("db/appfw/startup_appid=" + ReadString("db/appfw/startup_appid"));
                Console.WriteLine("db/appfw/booting_appid_backup=" + ReadString("db/appfw/booting_appid_backup"));
                Console.WriteLine("db/first_screen/type=" + ReadString("db/first_screen/type"));
                int a; vconf_get_int(AutoKey, out a);
                Console.WriteLine(AutoKey + "=" + a);
                return 0;
            }
            if (cmd == "verify")
            {
                CheckOriginalState();
                Console.WriteLine("ARN0_BASELINE_MATCH=1");
                return 0;
            }
            if (cmd == "apply") { Apply(); return 0; }
            if (cmd == "restore")
            {
                CheckRestorableState();
                RestoreOriginal();
                Console.WriteLine("ARN0_RESTORED=home=" + ReadHome() + ";home_appid=" + ReadString(HomeKey));
                return 0;
            }
            throw new Exception("Use query | verify | apply | restore");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("ARN0_ABORTED=" + ex);
            return 1;
        }
    }
}
