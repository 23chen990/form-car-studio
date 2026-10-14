import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
async function policy() {
  assert.ok(existsSync(new URL('src/platform/ios-shell.ts', root)), 'native API policy must exist');
  return import('../../src/platform/ios-shell.js');
}
test('native API bindings start disabled even if a caller supplies an origin', async () => {
  const { createNativePolicy } = await policy();
  const closed = createNativePolicy({ apiOrigin: 'https://api.form.example', approvedApiOrigins: ['https://api.form.example'] });
  assert.equal(closed.available, false);
  assert.throws(() => closed.apiURL('/api/v2/catalog'), /NATIVE_BINDING_DISABLED/);
});
test('approved HTTPS origin permits only relative V2 API paths', async () => {
  const { createNativePolicy } = await policy();
  const ready = createNativePolicy({ enabled: true, apiOrigin: 'https://api.form.example', approvedApiOrigins: ['https://api.form.example'] });
  assert.equal(ready.apiURL('/api/v2/auth/challenge'), 'https://api.form.example/api/v2/auth/challenge');
  for (const path of ['//evil.example/api/v2/catalog', 'https://evil.example/', '/api/v2/../admin', '/api/v2/%2e%2e/admin', '/api/v2/catalog#x', '/api/v2/\\evil']) {
    assert.throws(() => ready.apiURL(path), /INVALID_NATIVE_API_PATH/);
  }
});
test('unapproved, insecure and ambiguous API origins cannot open native binding', async () => {
  const { createNativePolicy } = await policy();
  for (const apiOrigin of ['http://api.form.example', 'https://evil.example', 'https://api.form.example/', 'https://name@api.form.example', 'https://api.form.example?x']) {
    assert.throws(() => createNativePolicy({ enabled: true, apiOrigin, approvedApiOrigins: ['https://api.form.example'] }), /INVALID_NATIVE_API_ORIGIN/);
  }
});
test('shell uses bundled assets, automatic safe areas and no blanket ATS exception', async () => {
  assert.ok(existsSync(new URL('capacitor.config.ts', root)), 'bundled Capacitor config must exist');
  const { default: config } = await import('../../capacitor.config.js');
  assert.equal(config.appId, 'invalid.form.placeholder');
  assert.equal(config.webDir, 'dist');
  assert.equal(config.server?.url, undefined);
  assert.deepEqual(config.server?.allowNavigation, []);
  assert.equal(config.ios?.contentInset, 'automatic');
  assert.equal(config.plugins?.CapacitorHttp?.enabled, false);
  assert.doesNotMatch(read('ios/App/App/Info.plist'), /NSAllowsArbitraryLoads|NSAllowsLocalNetworking/);
});
test('native project retains resources and has one plugin registration boundary', () => {
  assert.ok(existsSync(new URL('ios/App/App.xcodeproj/project.pbxproj', root)), 'complete Xcode project must exist');
  const project = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.match(project, /FORMPluginRegistry.swift in Sources/);
  assert.match(project, /PBXFileSystemSynchronizedRootGroup/);
  assert.match(project, /fileSystemSynchronizedGroups/);
  assert.match(project, /FORM_RELEASE_CONFIGURATION_REQUIRED/);
  assert.match(read('ios/App/App/SceneDelegate.swift'), /FORMBridgeViewController\(\)/);
  assert.match(read('ios/App/App/FORMPluginRegistry.swift'), /FORMPluginRegistry.register/);
  assert.match(read('ios/App/CapApp-SPM/Package.swift'), /exact: "8.5.3"/);
  assert.match(project, /IPHONEOS_DEPLOYMENT_TARGET = 15.0/);
  for (const file of ['Assets.xcassets/Contents.json', 'Assets.xcassets/AppIcon.appiconset/Contents.json', 'Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 'Assets.xcassets/Splash.imageset/Contents.json', 'Assets.xcassets/Splash.imageset/splash-2732x2732.png', 'Assets.xcassets/Splash.imageset/splash-2732x2732-1.png', 'Assets.xcassets/Splash.imageset/splash-2732x2732-2.png', 'Base.lproj/Main.storyboard', 'Base.lproj/LaunchScreen.storyboard']) {
    assert.ok(existsSync(new URL('ios/App/App/' + file, root)), file);
  }
});
test('actual release build phase rejects placeholder bundle and missing signing team', () => {
  const project = read('ios/App/App.xcodeproj/project.pbxproj');
  const script = JSON.parse(project.match(/shellScript = ("(?:\\.|[^"\\])*");/)![1]);
  const run = (configuration: string, bundle: string, team: string) => spawnSync('/bin/sh', ['-c', script], {
    env: { CONFIGURATION: configuration, PRODUCT_BUNDLE_IDENTIFIER: bundle, DEVELOPMENT_TEAM: team }, encoding: 'utf8',
  });
  assert.equal(run('Debug', 'invalid.form.placeholder', '').status, 0);
  assert.equal(run('Release', 'invalid.form.placeholder', '').status, 1);
  assert.equal(run('Release', 'com.synthetic.form', '').status, 1);
  assert.match(run('Release', 'invalid.form.placeholder', '').stderr, /FORM_RELEASE_CONFIGURATION_REQUIRED/);
});
