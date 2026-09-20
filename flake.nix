{
  description = "visual-qa-mcp — evidence-backed visual QA for coding agents";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/eaad089433ca2bb662274377d33df3d0e51ef28b";

  outputs =
    {
      nixpkgs,
      self,
      ...
    }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};

      node = pkgs.nodejs_22;

      # Browsers are always supplied by Nix. The wrapper below only sets a
      # default, so an externally provided PLAYWRIGHT_BROWSERS_PATH wins.
      playwrightBrowsers = pkgs.playwright-driver.browsers;

      /*
        Dependencies resolved by Bun into a fixed-output store path. Fetching
        happens in this derivation only, which lets the real build run offline
        and keeps `bun install` out of every evaluation.
      */
      bunDeps = pkgs.stdenvNoCC.mkDerivation {
        pname = "visual-qa-mcp-bun-deps";
        version = "0.0.0";
        src = self;

        nativeBuildInputs = [ pkgs.bun ];

        dontConfigure = true;
        dontFixup = true;

        buildPhase = ''
          runHook preBuild
          export HOME="$TMPDIR"
          export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
          export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
          export NIX_SSL_CERT_FILE="$SSL_CERT_FILE"
          bun install --frozen-lockfile --no-progress --ignore-scripts
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
        outputHash = "sha256-qoFsxGJwkwFPURfUuuBBo1AHmz3/IeoNPRivK0uou/c=";
      };

      visualQaMcp = pkgs.stdenvNoCC.mkDerivation {
        pname = "visual-qa-mcp";
        version = "0.1.0";
        src = self;

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
          cp -r dist node_modules package.json "$out/lib/visual-qa-mcp/"
          makeWrapper ${node}/bin/node "$out/bin/visual-qa-mcp" \
            --add-flags "$out/lib/visual-qa-mcp/dist/index.js" \
            --set-default PLAYWRIGHT_BROWSERS_PATH ${playwrightBrowsers} \
            --set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD 1 \
            --prefix PATH : ${pkgs.lib.makeBinPath [ node ]}
          runHook postInstall
        '';

        meta = {
          description = "MCP server for evidence-backed visual QA of web interfaces";
          mainProgram = "visual-qa-mcp";
          platforms = pkgs.lib.platforms.linux;
        };
      };
    in
    {
      packages.${system} = {
        default = visualQaMcp;
        visual-qa-mcp = visualQaMcp;
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          bashInteractive
          biome
          bun
          cacert
          coreutils
          deadnix
          git
          jq
          just
          nixfmt
          nodejs_22
          playwright-driver.browsers
          ripgrep
          statix
        ];

        PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsers;
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
        SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
        NIX_SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
      };

      formatter.${system} = pkgs.nixfmt-tree;
    };
}
