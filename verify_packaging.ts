import fs from 'fs';

function assert(c: unknown, m: string): void {
    if (!c) {
        console.error('FAIL', m);
        process.exit(1);
    }
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
    name: string;
    build: { productName: string; appId: string; win: { signAndEditExecutable: boolean; executableName: string } };
};

assert(pkg.name === 'one-trick', `package name ${pkg.name}`);
assert(pkg.build.productName === 'One Trick', `productName ${pkg.build.productName}`);
assert(pkg.build.appId === 'com.onetrick.app', `appId ${pkg.build.appId}`);
assert(pkg.build.win.executableName === 'OneTrick', `executableName ${pkg.build.win.executableName}`);
assert(pkg.build.win.signAndEditExecutable === true, 'win.signAndEditExecutable must embed icon.ico');
assert(fs.existsSync('build/icon.ico'), 'build/icon.ico');
assert(fs.statSync('build/icon.ico').size > 1000, 'build/icon.ico looks too small');
assert(fs.existsSync('build/installer.nsh'), 'build/installer.nsh');

console.log('verify:packaging ok');
