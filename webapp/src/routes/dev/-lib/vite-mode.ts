export const DEVELOPMENT_DEVTOOLS_OPTIONS = {
  // Source-inspection attributes would make the served preview differ from the delivered
  // email HTML. https://tanstack.com/devtools/latest/docs/source-inspector#ignoring-files-and-components
  injectSource: {
    enabled: true,
    ignore: { files: [/\/src\/emails\//] },
  },
}

export function enableDevelopmentUtilities(
  command: "build" | "serve",
  isPreview: boolean | undefined,
): boolean {
  return command === "serve" && !isPreview
}
