"use strict";

// Prepares the VS Code extension.
//
//   node scripts/build-vscode.js             bundle the toolchain into packages/vscode-kivo/kivo
//   node scripts/build-vscode.js --package   ... and create dist/kivo-<version>.vsix
//   node scripts/build-vscode.js --install   ... and install it into ~/.vscode/extensions
//
// The extension has no npm dependencies; the KIVO toolchain is copied in as-is.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const EXT = path.join(ROOT, "packages", "vscode-kivo");
const BUNDLE = path.join(EXT, "kivo", "packages");
const TOOLCHAIN = ["diagnostics", "lexer", "parser", "checker", "compiler", "runtime", "core", "formatter", "language-service", "language-server", "cli"];

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "package.json"), "utf8"));
const extId = `${manifest.publisher}.${manifest.name}`;

function copyDir(from, to, filter = () => true) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (!filter(src, entry)) continue;
    if (entry.isDirectory()) copyDir(src, dest, filter);
    else fs.copyFileSync(src, dest);
  }
}

function bundleToolchain() {
  fs.rmSync(path.join(EXT, "kivo"), { recursive: true, force: true });
  for (const name of TOOLCHAIN) {
    const src = path.join(ROOT, "packages", name);
    copyDir(src, path.join(BUNDLE, name), (file, entry) => !(entry.isDirectory() && (entry.name === "node_modules" || entry.name === "test")));
  }
  console.log(`✓ bundled the KIVO toolchain into ${path.relative(ROOT, BUNDLE)}`);
}

// Files that belong in the packaged extension.
function extensionFiles() {
  const ignore = fs.existsSync(path.join(EXT, ".vscodeignore")) ? fs.readFileSync(path.join(EXT, ".vscodeignore"), "utf8").split("\n").map((l) => l.trim()).filter(Boolean) : [];
  const ignored = (rel) =>
    rel.startsWith(".") ||
    ignore.some((pattern) => {
      const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$");
      return re.test(rel);
    });
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(EXT, full).split(path.sep).join("/");
      if (ignored(rel)) continue;
      if (entry.isDirectory()) walk(full);
      else out.push(rel);
    }
  };
  walk(EXT);
  return out.sort();
}

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function vsixManifest() {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${escapeXml(manifest.name)}" Version="${escapeXml(manifest.version)}" Publisher="${escapeXml(manifest.publisher)}" />
    <DisplayName>${escapeXml(manifest.displayName)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(manifest.description)}</Description>
    <Tags>${escapeXml([...(manifest.keywords || []), ...manifest.contributes.languages.flatMap((l) => l.extensions.map((e) => "__ext_" + e.replace(/^\./, "")))].join(","))}</Tags>
    <Categories>${escapeXml(manifest.categories.join(","))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(manifest.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="${escapeXml(manifest.repository ? manifest.repository.url : "")}" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
    </Properties>
    <License>extension/LICENSE.txt</License>
    <Icon>extension/${escapeXml(manifest.icon)}</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${escapeXml(manifest.icon)}" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

const CONTENT_TYPES = { ".json": "application/json", ".js": "application/javascript", ".md": "text/markdown", ".txt": "text/plain", ".png": "image/png", ".svg": "image/svg+xml", ".vsixmanifest": "text/xml", ".xml": "text/xml" };

function packageVsix() {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "kivo-vsix-"));
  const files = extensionFiles();
  for (const rel of files) {
    const dest = path.join(stage, "extension", rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(EXT, rel), dest);
  }
  fs.writeFileSync(path.join(stage, "extension.vsixmanifest"), vsixManifest());
  const exts = new Set(files.map((f) => path.extname(f).toLowerCase()).concat([".vsixmanifest"]));
  const types = [...exts].map((e) => `<Default Extension="${e}" ContentType="${CONTENT_TYPES[e] || "application/octet-stream"}"/>`).join("");
  fs.writeFileSync(path.join(stage, "[Content_Types].xml"), `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${types}</Types>`);
  const outDir = path.join(ROOT, "dist");
  fs.mkdirSync(outDir, { recursive: true });
  const vsix = path.join(outDir, `${manifest.name}-${manifest.version}.vsix`);
  fs.rmSync(vsix, { force: true });
  try {
    execFileSync("zip", ["-q", "-r", "-X", vsix, "[Content_Types].xml", "extension.vsixmanifest", "extension"], { cwd: stage });
  } catch {
    throw new Error("Creating the .vsix needs the `zip` command. Alternatively run: npx @vscode/vsce package (inside packages/vscode-kivo)");
  }
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(`✓ created ${path.relative(ROOT, vsix)} (${files.length} files)`);
  return vsix;
}

// Installs the .vsix through the editor's own command line, which registers the
// extension properly (copying folders into ~/.vscode/extensions is not reliable
// in recent VS Code versions).
function editorClis() {
  const names = ["code", "code-insiders", "cursor", "windsurf", "codium"];
  const found = [];
  const onPath = (name) => {
    try {
      execFileSync(process.platform === "win32" ? "where" : "which", [name], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  for (const n of names) if (onPath(n)) found.push(n);
  if (!found.length && process.platform === "darwin") {
    const apps = [
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
      "/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf",
      path.join(os.homedir(), "Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"),
    ];
    for (const a of apps) if (fs.existsSync(a)) found.push(a);
  }
  return found;
}

function install(vsix) {
  const clis = editorClis();
  if (!clis.length) {
    console.log("\nNo editor command line (code, cursor, ...) was found. Install the file by hand:");
    console.log(`  1. In VS Code open the Extensions view (Cmd/Ctrl+Shift+X)`);
    console.log(`  2. Click the ... menu at the top → "Install from VSIX..."`);
    console.log(`  3. Choose ${vsix}`);
    return;
  }
  for (const cli of clis) {
    try {
      execFileSync(cli, ["--install-extension", vsix, "--force"], { stdio: "inherit", shell: process.platform === "win32" });
      console.log(`✓ installed with ${path.basename(cli)}`);
    } catch {
      console.log(`✗ ${cli} could not install the extension`);
    }
  }
  console.log("Now reload the editor: Cmd/Ctrl+Shift+P → \"Developer: Reload Window\".");
}

bundleToolchain();
if (process.argv.includes("--install")) install(packageVsix());
else if (process.argv.includes("--package")) packageVsix();
