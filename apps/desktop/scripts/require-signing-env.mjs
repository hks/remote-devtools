// Signed builds must name their certificate: the keychain may hold other teams' certificates that electron-builder
// would otherwise be free to pick. CI passes the Developer ID certificate as CSC_LINK; locally set CSC_NAME.
if (!process.env.CSC_LINK && !process.env.CSC_NAME) {
    console.error('Set CSC_NAME="Developer ID Application: <Name> (<TEAMID>)" (or CSC_LINK) for a signed build.');
    console.error('For an unsigned local package use `pnpm dist:desktop`.');
    process.exit(1);
}
const notarize = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
const missing = notarize.filter((name) => !process.env[name]);
if (missing.length > 0) {
    console.warn(`Notarization will be skipped (missing ${missing.join(', ')}); Gatekeeper will warn users about this build.`);
}
