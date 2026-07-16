# AstreaBlue Native Windows Agent

This is the Node.js-free Windows service replacement for the pilot agent. It targets the .NET Framework already included with supported Windows 10/11 company laptops.

## Build and package

Run from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-native-agent.ps1
powershell -ExecutionPolicy Bypass -File .\create-native-package.ps1
```

## Install a pilot laptop

1. In AstreaBlue, open **Endpoint Management → Administration** and create a one-time enrollment code.
2. Copy the ZIP to the laptop and extract it.
3. Run PowerShell as Administrator.
4. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\native-install.ps1
```

The installer defaults to `https://backend-production-fc059.up.railway.app`, consumes the one-time code, preserves an existing pilot device UUID, protects the unique credential with Windows DPAPI, and installs the automatic Windows service.

The service synchronizes the consent-derived endpoint policy every minute and sends hardware/software inventory every 24 hours when allowed. A credential-free user-session companion samples foreground application, window title, and idle time; the service forwards it only when the effective policy and approved employee consent enable activity monitoring.

Version `native-1.2.0` also supports consent-approved periodic screenshots. The interactive companion displays a Windows notification before capture, then hands the JPEG to the authenticated Windows service. The backend independently revalidates current assignment, consent, and policy, encrypts the image with AES-256-GCM, and stores only ciphertext in private Cloudflare R2. Screenshot access remains authenticated and branch-scoped, and expired objects are deleted according to the effective retention policy.

Before enabling screenshot capture in production, configure a unique 32-byte `SCREENSHOT_ENCRYPTION_KEY` in the Railway backend environment. Generate it directly in an administrator terminal with:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Do not place that key in source control or inside the agent ZIP.

Signed automatic updates remain disabled until a trusted company signing certificate and HTTPS manifest are configured. See `SIGNED_UPDATES.md`.

## Support

```powershell
.\native-diagnostics.ps1
.\native-repair.ps1
.\native-uninstall.ps1
```

Uninstall preserves identity and logs by default. Use `native-uninstall.ps1 -PurgeIdentity` only when the laptop must be treated as an entirely new device later.
