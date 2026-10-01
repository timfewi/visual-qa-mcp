{
  description = "visual-qa-mcp — evidence-backed visual QA for coding agents";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/7a0f122f5090cf4c2ade2a13a0e229d4e19ba71f";
    project-check = {
      url = "github:timfewi/project-check-nix/f70de45d69b9ca9a31f5b9f94e316ac6e43e514e";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, project-check, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      perSystem = nixpkgs.lib.genAttrs systems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          sources = import ./nix/sources.nix {
            inherit (pkgs) lib;
            root = ./.;
          };
          dependencyCpu = if system == "aarch64-linux" then "arm64" else "x64";
          dependencyHashes = import ./nix/dependency-hashes.nix;
          bunDeps = pkgs.callPackage ./packages/bun-deps.nix {
            src = sources.dependencies;
            cpu = dependencyCpu;
            hash = dependencyHashes.${system};
          };
          node = pkgs.nodejs_24;
          # An explicitly supplied browser path still overrides this default.
          playwrightBrowsers = pkgs.playwright-driver.browsers;
          visualQaMcp = pkgs.stdenvNoCC.mkDerivation {
            pname = "visual-qa-mcp";
            version = "0.1.0";
            src = sources.package;
            nativeBuildInputs = [ pkgs.makeWrapper ];
            dontConfigure = true;
            buildPhase = ''
              runHook preBuild
              cp -r ${bunDeps}/node_modules ./node_modules
              chmod -R u+w ./node_modules
              ${node}/bin/node ./node_modules/typescript/bin/tsc -p tsconfig.build.json
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              mkdir -p "$out/lib/visual-qa-mcp" "$out/bin"
              cp -r dist node_modules package.json LICENSE "$out/lib/visual-qa-mcp/"
              makeWrapper ${node}/bin/node "$out/bin/visual-qa-mcp" \
                --add-flags "$out/lib/visual-qa-mcp/dist/index.js" \
                --set-default PLAYWRIGHT_BROWSERS_PATH ${playwrightBrowsers} \
                --set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD 1 \
                --prefix PATH : ${pkgs.lib.makeBinPath [ node ]}
              runHook postInstall
            '';
            passthru = { inherit bunDeps dependencyCpu; };
            meta = {
              description = "MCP server for evidence-backed visual QA of web interfaces";
              mainProgram = "visual-qa-mcp";
              platforms = pkgs.lib.platforms.linux;
              license = pkgs.lib.licenses.mit;
            };
          };
        in
        {
          packages = {
            default = visualQaMcp;
            visual-qa-mcp = visualQaMcp;
            bun-deps = bunDeps;
          };
          checks.package = visualQaMcp;
          devShells.default = pkgs.mkShell {
            packages = [
              project-check.packages.${system}.project-check
              pkgs.bashInteractive
              pkgs.biome
              pkgs.bun
              pkgs.cacert
              pkgs.coreutils
              pkgs.deadnix
              pkgs.git
              pkgs.jq
              pkgs.just
              pkgs.nixfmt
              pkgs.nodejs_24
              pkgs.playwright-driver.browsers
              pkgs.python3
              pkgs.ripgrep
              pkgs.statix
            ];
            PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsers;
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
            SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
            NIX_SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
          };
          formatter = pkgs.nixfmt-tree;
        }
      );
    in
    {
      packages = nixpkgs.lib.mapAttrs (_: value: value.packages) perSystem;
      checks = nixpkgs.lib.mapAttrs (_: value: value.checks) perSystem;
      devShells = nixpkgs.lib.mapAttrs (_: value: value.devShells) perSystem;
      formatter = nixpkgs.lib.mapAttrs (_: value: value.formatter) perSystem;
    };
}
