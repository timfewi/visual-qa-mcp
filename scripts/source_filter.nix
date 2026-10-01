let
  flake = builtins.getFlake (builtins.getEnv "SOURCE_CHECK_FLAKE_URI");
  sources = import ../nix/sources.nix {
    lib = flake.inputs.nixpkgs.lib;
    root = /. + builtins.getEnv "SOURCE_CHECK_FIXTURE_ROOT";
  };
  walk =
    prefix: directory:
    let
      entries = builtins.readDir directory;
    in
    builtins.concatMap (
      name:
      if entries.${name} == "directory" then
        walk "${prefix}${name}/" "${directory}/${name}"
      else
        [ "${prefix}${name}" ]
    ) (builtins.attrNames entries);
  manifest = builtins.fromJSON (builtins.readFile "${flake}/package.json");
  native = flake.inputs.nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" ] (
    system:
    let
      pkgs = flake.inputs.nixpkgs.legacyPackages.${system};
      package = flake.packages.${system}.default;
      shell = flake.devShells.${system}.default;
      runner = flake.inputs.project-check.packages.${system}.project-check;
    in
    assert package.system == system;
    assert shell.system == system;
    assert runner.system == system;
    assert builtins.elem runner shell.nativeBuildInputs;
    assert flake.formatter.${system}.system == system;
    assert flake.checks.${system}.package == package;
    assert package.bunDeps == flake.packages.${system}.bun-deps;
    assert package.bunDeps.system == system;
    assert package.dependencyCpu == (if system == "aarch64-linux" then "arm64" else "x64");
    assert manifest.packageManager == "bun@${pkgs.bun.version}";
    assert manifest.dependencies.playwright == pkgs.playwright-driver.version;
    assert toString shell.PLAYWRIGHT_BROWSERS_PATH == toString pkgs.playwright-driver.browsers;
    {
      inherit (package) system dependencyCpu;
      packageFiles = walk "" package.src;
      dependencyFiles = walk "" package.bunDeps.src;
      dependencyHash = package.bunDeps.outputHash;
    }
  );
in
{
  package = {
    path = toString sources.package;
    files = walk "" sources.package;
  };
  dependencies = {
    path = toString sources.dependencies;
    files = walk "" sources.dependencies;
  };
  inherit native;
}
