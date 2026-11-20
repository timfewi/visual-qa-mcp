{ pkgs }:
{
  packages = with pkgs; [
    bashInteractive
    biome
    bun
    cacert
    coreutils
    deadnix
    git
    husky
    jq
    just
    nixfmt
    nodejs_24
    playwright-driver.browsers
    python3
    ripgrep
    shfmt
    statix
  ];

  env = {
    PLAYWRIGHT_BROWSERS_PATH = toString pkgs.playwright-driver.browsers;
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
    NIX_SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
  };
}
