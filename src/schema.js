export const commandSchema = {
  commands: [
    {
      name: "init",
      description: "Add root Turbo boundary rules and per-package tags.",
      options: [
        option("--json", "Print a machine-readable response envelope."),
        option(
          "--dry-run",
          "Print planned file writes without changing files."
        ),
      ],
      output: "InitResult",
    },
    {
      name: "check",
      description:
        "Validate Turbo boundary config or a JS architecture profile.",
      options: [
        option("--json", "Print a machine-readable response envelope."),
        option(
          "--no-turbo",
          "Validate convention config without running turbo boundaries."
        ),
        option(
          "--profile",
          "Check a JS architecture profile: feature-sliced, next-feature, or clean-node."
        ),
      ],
      output: "CheckResult | ProfileCheckResult",
    },
    {
      name: "explain",
      description: "Explain whether one workspace may depend on another.",
      arguments: [
        argument(
          "from",
          "Package name, workspace path, or workspace basename."
        ),
        argument("to", "Package name, workspace path, or workspace basename."),
      ],
      options: [
        option("--json", "Print a machine-readable response envelope."),
      ],
      output: "ExplainResult",
    },
    {
      name: "help",
      description: "Show command help.",
      options: [
        option("--json", "Print a machine-readable response envelope."),
        option("--schema", "Print this command schema as JSON."),
      ],
      output: "CommandSchema",
    },
  ],
  defaultCommand: "check",
  description: "Opinionated Turborepo package boundary conventions.",
  errorShape: {
    code: "string",
    file: "string | undefined",
    is_retriable: "boolean",
    message: "string",
    suggestions: "string[]",
  },
  name: "boundaries",
  responseEnvelope: {
    data: "object | undefined",
    error: "BoundaryProblem | undefined",
    success: "boolean",
  },
};

function option(name, description) {
  return { description, name };
}

function argument(name, description) {
  return { description, name, required: true };
}
