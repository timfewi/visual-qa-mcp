{
  stdenvNoCC,
  bun,
  cacert,
  src,
  cpu,
  hash,
}:
assert builtins.elem cpu [
  "x64"
  "arm64"
];
stdenvNoCC.mkDerivation {
  pname = "visual-qa-mcp-bun-deps";
  version = "0.0.0";
  inherit src;
  nativeBuildInputs = [ bun ];
  dontConfigure = true;
  dontFixup = true;
  buildPhase = ''
    runHook preBuild
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
    export SSL_CERT_FILE="${cacert}/etc/ssl/certs/ca-bundle.crt"
    export NIX_SSL_CERT_FILE="$SSL_CERT_FILE"
    bun install --frozen-lockfile --no-progress --ignore-scripts --linker=hoisted \
      --cache-dir="$TMPDIR/bun-cache" \
      --os=linux --cpu=${cpu} --registry=https://registry.npmjs.org
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -r node_modules "$out/node_modules"
    runHook postInstall
  '';
  outputHashMode = "recursive";
  outputHashAlgo = "sha256";
  outputHash = hash;
}
