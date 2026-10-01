{ lib, root }:
let
  sourceFor =
    dependencies:
    lib.cleanSourceWith {
      name = if dependencies then "visual-qa-dependencies" else "visual-qa-source";
      src = root;
      filter =
        path: type:
        let
          relative = lib.removePrefix "${toString root}/" (toString path);
          parts = lib.splitString "/" relative;
          inTree = builtins.head parts == "src";
          runtimeDirectory = lib.any (
            part:
            builtins.elem part [
              ".ast-index"
              ".direnv"
              ".git"
              ".visual-qa"
              "node_modules"
              "dist"
              "coverage"
            ]
          ) parts;
          manifests = [
            "package.json"
            "bun.lock"
          ];
          packageFiles = manifests ++ [
            "tsconfig.json"
            "tsconfig.build.json"
            "LICENSE"
          ];
        in
        !runtimeDirectory
        && (
          (!dependencies && inTree && type == "directory")
          || (
            type == "regular"
            && (
              builtins.elem relative (if dependencies then manifests else packageFiles)
              || (!dependencies && inTree && lib.hasSuffix ".ts" relative)
            )
          )
        );
    };
in
{
  dependencies = sourceFor true;
  package = sourceFor false;
}
