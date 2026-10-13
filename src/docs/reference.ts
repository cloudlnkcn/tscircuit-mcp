/**
 * Embedded tscircuit language reference, exposed as MCP resources and used in
 * prompt templates. Kept concise so agents can write correct TSX circuits
 * without external lookups.
 */

export const API_REFERENCE = `# tscircuit TSX Quick Reference

tscircuit lets you define PCBs with React-like JSX. A file exports a default
component that renders a \`<board>\`.

## Basic structure

\`\`\`tsx
export default () => (
  <board width="30mm" height="30mm">
    <resistor name="R1" resistance="10k" footprint="0402" pcbX={-5} pcbY={0} />
    <capacitor name="C1" capacitance="100nF" footprint="0402" pcbX={5} pcbY={0} />
    <trace from=".R1 > .2" to=".C1 > .1" />
  </board>
)
\`\`\`

## Layout: let the engine do it (IMPORTANT)

Do NOT hand-write \`pcbX\`/\`pcbY\`/\`schX\`/\`schY\` coordinates unless the user asked
for a specific placement. When coordinates are omitted:

- components are **auto-placed** (no overlaps, positioned by connectivity)
- traces are **auto-routed** on the PCB
- schematic symbols are **auto-arranged** and wired

Writing coordinates by hand is the most common source of bad layouts. Prefer:

\`\`\`tsx
<board width="40mm" height="30mm">
  <chip name="U1" footprint="soic8" pinLabels={{...}} />
  <capacitor name="C1" capacitance="100nF" footprint="0402" />
  <trace from=".C1 > .1" to=".U1 > .VCC" />
</board>
\`\`\`

Only add coordinates when you mean it, e.g. decoupling caps near the MCU:
\`<capacitor pcbX={-5} pcbY={8} />\`. Use \`tscircuit_list_elements\` to check valid
element names before writing code, and \`tscircuit_get_element_docs\` for props.

## Common components

- \`<resistor name="R1" resistance="10k" footprint="0402" />\`
- \`<capacitor name="C1" capacitance="100nF" footprint="0603" />\`
- \`<polarized_capacitor name="C2" capacitance="10uF" footprint="cap_alm_smd_6.6x5.3" />\`
- \`<inductor name="L1" inductance="10uH" footprint="0805" />\`
- \`<diode name="D1" footprint="0402" />\` (add \`reverseVworking\` etc. as needed)
- \`<led name="LED1" color="red" footprint="0603" />\`
- \`<transistor name="Q1" footprint="SOT-23" />\`
- \`<mosfet name="M1" channel="n" footprint="SOT-23" />\`
- \`<switch name="SW1" footprint="btn_rect_4p25x25h" />\`
- \`<crystal name="Y1" frequency="16MHz" footprint="osc_smd_3225" />\`
- \`<chip name="U1" footprint="soic8" pinLabels={{1:"VCC",2:"GND",3:"TX",4:"RX"}} />\`
- \`<chip name="U2" footprint="qfp48" manufacturerPartNumber="STM32F103C8T6" />\`
- \`<power_source name="V3_3" voltage="3.3V" />\`
- \`<voltage_source name="VS" voltage="5V" />\`
- \`<net_alias name="SPI_CLK" />\` (create named nets without a component)
- \`<jumper name="J1" footprint="jumper2x2" />\`
- \`<pinheader name="J2" pinCount={4} pitch="2.54mm" male /> \` (footprints auto-generated)
- \`<button name="BTN1" />\`
- \`<battery name="BAT1" cellCapacity="100mAh" voltage="3.7V" />\`

The full list of valid elements (verified against the evaluator) is available
via the \`tscircuit_list_elements\` tool; per-element props via
\`tscircuit_get_element_docs\`.

## Chip with labeled pins and internal connections

\`\`\`tsx
<chip
  name="U1"
  footprint="soic8"
  pinLabels={{
    1: "VCC",
    2: "GND",
    3: ["SDA", "io0"],
    4: "SCL",
  }}
  connections={{
    VCC: "net.VCC",      // connect pin to a named net
    GND: "net.GND",
    SDA: "R1.2",         // connect to another component pin
    SCL: "net.I2C_SCL",
  }}
/>
\`\`\`

## Ground and power

There is NO \`<ground />\` element — the evaluator silently ignores it and no
connection is made. Ground pins with \`to="net.GND"\` instead:

\`\`\`tsx
<board width="20mm" height="20mm">
  <resistor name="R1" resistance="1k" footprint="0402" />
  <capacitor name="C1" capacitance="100nF" footprint="0402" />
  <trace from=".R1 > .2" to="net.GND" />
  <trace from=".C1 > .1" to="net.GND" />
</board>
\`\`\`

Equivalent patterns:
- \`<net_alias name="GND" />\` then trace to \`.GND\`
- chip \`connections={{ GND: "net.GND" }}\`
- named nets work for any rail, e.g. \`net.VCC\`, \`net.V3_3\`

A \`GND\` source_net appears in the eval summary when grounding worked — check
the "Nets:" line of the \`tscircuit_eval\` output to confirm.

## Traces

Three equivalent styles:

\`\`\`tsx
<trace from=".R1 > .1" to=".C1 > .1" />        // selector syntax
<trace from="R1.1" to="C1.1" />                 // dot syntax
<trace from=".U1 > .VCC" to="net.VCC" />        // pin label to net
\`\`\`

Pin selectors: \`.R1 > .1\` (pin number), \`.R1 > .left\` (side), \`.U1 > .VCC\`
(pin label). Nets: \`net.MYNET\` or \`<netalias />\` + reference.

## Positioning and layout

- \`pcbX\`, \`pcbY\`: position on PCB in mm (accept numbers or strings like "3mm").
- \`schX\`, \`schY\`: position on schematic grid.
- \`rotation\`: degrees on PCB. \`layer="top" | "bottom"\`.
- \`<group>\` groups elements; subcircuits: \`<subcircuit>\`.
- Automatic placement when pcbX/pcbY omitted (and auto-routing of traces).

## Footprints

String names (from @tscircuit/footprinter) are auto-resolved:
\`0402\`, \`0603\`, \`0805\`, \`1206\`, \`soic8\`, \`ssop16\`, \`qfp48\`, \`qfn16\`,
\`bga32\`, \`sot23\`, \`sot23-5\`, \`to92\`, \`tssop20\`, \`pinrow4\`, \`sod323\`,
\`led1608\`, \`c0603\`, \`r0402\` ...

\`\`\`tsx
<footprint name="MYFP">
  <smtpad shape="rect" width="1mm" height="0.6mm" pcbX={-0.95} pcbY={0} />
  <smtpad shape="circle" radius="0.5mm" pcbX={0.95} pcbY={0} portHints={["1","2"]} />
  <plated_hole portHints={["1"]} holeDiameter="1mm" outerDiameter="1.6mm" pcbX={0} />
  <silkscreentext text="MYFP" pcbX={0} pcbY={-2} anchor="center" />
</footprint>
\`\`\`

## Schematic-only symbols

\`<schematicbox>\`-style rendering happens automatically from \`<chip>\` with
\`schPortArrangement\`:

\`\`\`tsx
<chip name="U3" footprint="soic8"
  schPortArrangement={{
    leftSide: { pins: ["GND","TX","RX"], direction: "top-to-bottom" },
    rightSide: { pins: ["VCC"], direction: "bottom-to-top" },
  }}
  pinLabels={{ GND:1, TX:2, RX:3, VCC:4 }}
/>
\`\`\`

## Useful board-level props

- \`width\` / \`height\`: overall board size (e.g. "40mm").
- \`routingDifficulty="kitchenSink"\`: stronger autorouter effort.
- \`layout\`: automatic component placement.
- Unknown props are ignored; stick to documented ones.

## Simulation

\`\`\`tsx
<simulation_experiment VoltageProbes={[".R1 > .1"]} CurrentProbes={[".R1"]} />
\`\`\`

## Importing registry components

\`\`\`tsx
import { MySensor } from "@tsci/seveibar.MySensor"
\`\`\`
Packages from the tscircuit registry (tscircuit.com) are fetched automatically
during evaluation.
`

export const EXAMPLES = `# Example: minimal working board

\`\`\`tsx
export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="10k" footprint="0402" pcbX={-3} />
    <capacitor name="C1" capacitance="100nF" footprint="0402" pcbX={3} />
    <trace from=".R1 > .1" to=".C1 > .1" />
  </board>
)
\`\`\`

# Example: MCU + bypass caps, auto-routed

\`\`\`tsx
export default () => (
  <board width="40mm" height="30mm" routingDifficulty="kitchenSink">
    <chip
      name="U1"
      footprint="qfp48"
      manufacturerPartNumber="STM32F103C8T6"
      pcbX={0} pcbY={0}
    />
    <capacitor name="C1" capacitance="100nF" footprint="0402" pcbX={-10} pcbY={8} />
    <capacitor name="C2" capacitance="100nF" footprint="0402" pcbX={-10} pcbY={-8} />
    <resistor name="R1" resistance="10k" footprint="0402" pcbX={10} pcbY={0} />
    <trace from=".C1 > .1" to=".U1 > .VDD_1" />
    <trace from=".C2 > .1" to=".U1 > .VDD_2" />
    <trace from=".R1 > .1" to=".U1 > .NRST" />
  </board>
)
\`\`\`
`
