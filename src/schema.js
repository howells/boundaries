export const commandSchema = {
  name: "boundaries",
  description: "Opinionated Turborepo package boundary conventions.",
  commands: [
    {
      name: "init",
      description: "Add root Turbo boundary rules and per-package tags.",
      options: [
        option("--json", "Print a machine-readable response envelope."),
        option("--dry-run", "Print planned file writes without changing files."),
      ],
      output: "InitResult",
    },
    {
      name: "check",
      description: "Validate boundary config and optionally run turbo boundaries.",
      options: [
        option("--json", "Print a machine-readable response envelope."),
        option("--no-turbo", "Validate convention config without running turbo boundaries."),
      ],
      output: "CheckResult",
    },
    {
      name: "explain",
      description: "Explain whether one workspace may depend on another.",
      arguments: [
        argument("from", "Package name, workspace path, or workspace basename."),
        argument("to", "Package name, workspace path, or workspace basename."),
      ],
      options: [option("--json", "Print a machine-readable response envelope.")],
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
  responseEnvelope: {
    success: "boolean",
    data: "object | undefined",
    error: "BoundaryProblem | undefined",
  },
  errorShape: {
    code: "string",
    message: "string",
    is_retriable: "boolean",
    suggestions: "string[]",
    file: "string | undefined",
  },
};

function option(name, description) {
  return { name, description };
}

function argument(name, description) {
  return { name, description, required: true };
}
