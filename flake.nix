{
  description = "Project development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/eaad089433ca2bb662274377d33df3d0e51ef28b";

  outputs =
    { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          bashInteractive
          biome
          coreutils
          deadnix
          esbuild
          git
          jq
          just
          nixfmt
          nodejs_22
          pnpm
          playwright-driver.browsers
          ripgrep
          statix
        ];

        PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
        ESBUILD_BINARY_PATH = "${pkgs.esbuild}/bin/esbuild";
      };

      formatter.${system} = pkgs.nixfmt-tree;
    };
}
