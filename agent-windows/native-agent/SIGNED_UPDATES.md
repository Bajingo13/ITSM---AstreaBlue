# Signed Agent Updates

The native agent contains a disabled-by-default update framework. It will install an update only when all of these checks pass:

1. The manifest and both executable downloads use HTTPS.
2. The manifest channel matches the laptop's `pilot` or `stable` channel.
3. The candidate version is newer than the installed version.
4. Each downloaded executable matches its manifest SHA-256 digest.
5. Each executable has a valid Authenticode signature from the exact configured company-certificate thumbprint.
6. The rollback updater stops the service, backs up both executables, replaces them, verifies the new version, restarts the service, and restores the backups if validation fails.

## Manifest format

```json
{
  "success": true,
  "data": {
    "version": "native-1.2.0",
    "channel": "pilot",
    "service_download_url": "https://example.invalid/AstreaBlue.Agent.Service.exe",
    "service_sha256": "lowercase-sha256",
    "companion_download_url": "https://example.invalid/AstreaBlue.ActivityCompanion.exe",
    "companion_sha256": "lowercase-sha256"
  }
}
```

The manifest endpoint and downloads may require the same `x-agent-token` device credential used by the monitoring API.

## Enable after obtaining the company certificate

Pass all update parameters during installation:

```powershell
.\native-install.ps1 `
  -UpdateManifestUrl "https://backend.example.com/api/v1/agent-updates/latest" `
  -TrustedSignerThumbprint "COMPANY_CERTIFICATE_THUMBPRINT" `
  -UpdateChannel pilot
```

Never configure a self-signed development certificate on production laptops. Test in `pilot`, promote the identical signed binaries to `stable`, and retain the previous signed release for rollback.
