{ pkgs, ... }:
{
  devenv.latestVersion = "2.4.0";
  inherit (import ./nix/dev-tools.nix { inherit pkgs; }) packages env;
}
