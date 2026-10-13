import { z } from "zod"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { ToolCallback } from "../types.js"

const DEFAULT_CIRCUIT = `import { LedCircuit } from "./led-circuit.tsx"

export default () => (
  <board width="20mm" height="20mm">
    <LedCircuit name="LED1" />
  </board>
)
`

const LED_CIRCUIT = `export const LedCircuit = ({ name }: { name: string }) => (
  <group name={name}>
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-3} />
    <led name="LED" color="green" footprint="0603" pcbX={3} />
    <trace from=".R1 > .2" to=".LED > .anode" />
    <trace from=".LED > .cathode" to="net.GND" />
  </group>
)
`

const createProjectInput = {
  directory: z.string().describe("Target directory for the new project (created if missing)."),
  name: z.string().optional().describe("Project/package name (defaults to the directory name)."),
  with_example: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include example circuit files (default true)."),
}

export const createProject: ToolCallback<typeof createProjectInput> = {
  name: "tscircuit_create_project",
  title: "Scaffold a tscircuit project",
  description:
    "Create a new tscircuit project directory with package.json, tsconfig.json, a gitignore and an " +
    "example circuit (entry.tsx). The project uses the official `tscircuit` package; run `npm install` " +
    "then `npx tsci dev` inside it to open the live preview.",
  inputSchema: createProjectInput,
  annotations: { readOnlyHint: false },

  async execute({ directory, name, with_example }) {
    const dir = resolve(directory)
    mkdirSync(dir, { recursive: true })

    const pkgName = name ?? join(dir).split(/[/\\]/).filter(Boolean).pop() ?? "my-circuit"

    // Never clobber an existing project silently
    const existing = Object.keys(
      {
        "package.json": 1,
        "tsconfig.json": 1,
        "entry.tsx": 1,
        "led-circuit.tsx": 1,
      },
    ).filter((f) => existsSync(join(dir, f)))
    if (existing.length > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Refusing to create project: ${dir} already contains ${existing.join(", ")}. ` +
              `Choose an empty directory or remove these files first.`,
          },
        ],
        isError: true,
      }
    }

    const files: Record<string, string> = {
      "package.json": JSON.stringify(
        {
          name: pkgName,
          version: "0.1.0",
          type: "module",
          scripts: {
            dev: "tsci dev",
            build: "tsci build",
            export: "tsci export",
          },
          devDependencies: {
            tscircuit: "latest",
            typescript: "^5.0.0",
          },
        },
        null,
        2,
      ),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            jsx: "react-jsx",
            strict: true,
            skipLibCheck: true,
            noEmit: true,
          },
          include: ["**/*.tsx", "**/*.ts"],
        },
        null,
        2,
      ),
      ".gitignore": "node_modules/\ndist/\noutput/\n",
      "README.md": `# ${pkgName}\n\nA tscircuit project.\n\n\`\`\`bash\nnpm install\nnpx tsci dev   # live preview at http://localhost:3020\nnpx tsci build # produce circuit json + fab files\n\`\`\`\n`,
    }

    if (with_example !== false) {
      files["entry.tsx"] = DEFAULT_CIRCUIT
      files["led-circuit.tsx"] = LED_CIRCUIT
    }

    for (const [rel, content] of Object.entries(files)) {
      writeFileSync(join(dir, rel), content, "utf-8")
    }

    return {
      content: [
        {
          type: "text" as const,
          text:
            `# Project created: ${dir}\n\n` +
            `Files: ${Object.keys(files).join(", ")}\n\n` +
            `Next steps:\n` +
            `1. \`cd ${dir} && npm install\`\n` +
            `2. \`npx tsci dev\` — opens the live preview at http://localhost:3020\n` +
            `3. Edit \`entry.tsx\` (main board) — or keep iterating here with tscircuit_eval.`,
        },
      ],
    }
  },
}
