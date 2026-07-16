using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace AstreaBlue.ActivityCompanion
{
    internal static class NativeMethods
    {
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
        [DllImport("user32.dll")] internal static extern bool GetLastInputInfo(ref LastInputInfo info);

        [StructLayout(LayoutKind.Sequential)]
        internal struct LastInputInfo { internal uint cbSize; internal uint dwTime; }
    }

    internal static class Program
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static readonly string LogDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AstreaBlue", "MonitoringAgent", "logs");

        private static void Log(string level, string message)
        {
            try
            {
                Directory.CreateDirectory(LogDirectory);
                string path = Path.Combine(LogDirectory, "companion-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".log");
                File.AppendAllText(path, String.Format("[{0}] [{1}] {2}{3}", DateTime.UtcNow.ToString("o"), level, message, Environment.NewLine));
            }
            catch { }
        }

        private static Dictionary<string, object> ReadActivity()
        {
            IntPtr window = NativeMethods.GetForegroundWindow();
            StringBuilder title = new StringBuilder(512);
            NativeMethods.GetWindowText(window, title, title.Capacity);
            uint processId;
            NativeMethods.GetWindowThreadProcessId(window, out processId);
            string processName = "Unknown";
            try { processName = Process.GetProcessById((int)processId).ProcessName; } catch { }
            NativeMethods.LastInputInfo input = new NativeMethods.LastInputInfo();
            input.cbSize = (uint)Marshal.SizeOf(input);
            NativeMethods.GetLastInputInfo(ref input);
            uint elapsed = unchecked((uint)Environment.TickCount - input.dwTime);
            Dictionary<string, object> activity = new Dictionary<string, object>();
            activity["app_name"] = processName;
            activity["window_title"] = title.ToString();
            activity["idle_seconds"] = Math.Max(0, elapsed / 1000);
            return activity;
        }

        private static void SendActivity(Dictionary<string, object> activity)
        {
            using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", "AstreaBlueActivityV1", PipeDirection.Out))
            {
                pipe.Connect(5000);
                using (StreamWriter writer = new StreamWriter(pipe, new UTF8Encoding(false)))
                {
                    writer.WriteLine(Json.Serialize(activity));
                    writer.Flush();
                }
            }
        }

        private static int Main()
        {
            string mutexName = "Local\\AstreaBlueActivityCompanion." + Process.GetCurrentProcess().SessionId;
            bool created;
            using (Mutex mutex = new Mutex(true, mutexName, out created))
            {
                if (!created) return 0;
                Log("INFO", "Activity companion started in Windows session " + Process.GetCurrentProcess().SessionId + ".");
                bool firstDelivery = true;
                string previousError = null;
                while (true)
                {
                    try
                    {
                        SendActivity(ReadActivity());
                        if (firstDelivery || previousError != null) Log("INFO", "Activity sample delivered to the monitoring service.");
                        firstDelivery = false;
                        previousError = null;
                    }
                    catch (Exception error)
                    {
                        if (!String.Equals(previousError, error.Message, StringComparison.Ordinal))
                            Log("ERROR", "Activity sample delivery failed: " + error.Message);
                        previousError = error.Message;
                    }
                    Thread.Sleep(TimeSpan.FromSeconds(30));
                }
            }
        }
    }
}
