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
                while (true)
                {
                    try { SendActivity(ReadActivity()); } catch { }
                    Thread.Sleep(TimeSpan.FromSeconds(30));
                }
            }
        }
    }
}
