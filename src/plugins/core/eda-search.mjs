/**
 * smart_eda_search — EDA 領域智慧知識引擎
 *
 * 多來源 EDA/IC Design 資料查詢工具，完全免費，不需要 API 金鑰：
 *   1. GitHub API — PDK repo、cell library、EDA tool repo（免費，60 req/hr）
 *   2. OpenAlex — EDA 學術論文（免費，10 萬 req/day）
 *   3. Semantic Scholar — EDA 論文 + TLDR 摘要（免費，100 req/5min）
 *   4. OpenROAD / Yosys / OpenLane 文件 — 常用 EDA 工具文件索引
 *
 * 定位：與 MCP4EDA 等「工具執行器」互補，提供「知識查詢」能力。
 *   • MCP4EDA 們：跑合成、模擬、P&R（需安裝工具 + Docker）
 *   • smart_eda_search：查 PDK cell、找論文、找工具用法（免安裝）
 */

const USER_AGENT = 'SmartMCP/2.0 (eda-search)';
const DEFAULT_TIMEOUT = 20000;

// ── GitHub API ───────────────────────────────────────────────────────────────
const GITHUB_API = 'https://api.github.com';

// ── OpenAlex ─────────────────────────────────────────────────────────────────
const OPENALEX_API = 'https://api.openalex.org';

// ── Semantic Scholar ─────────────────────────────────────────────────────────
const SCHOLAR_API = 'https://api.semanticscholar.org/graph/v1';

// ── 常用 EDA 工具快速索引 ────────────────────────────────────────────────────
const EDA_TOOL_INDEX = {
  'yosys': {
    name: 'Yosys Open Synthesis Suite',
    repo: 'YosysHQ/yosys',
    docs: 'https://yosyshq.readthedocs.io/projects/yosys/en/latest/',
    category: 'synthesis',
    desc: 'Extensible Verilog RTL synthesis suite. Synthesizes Verilog to gate-level netlists for FPGA/ASIC.',
    alt: 'Synopsys Design Compiler',
  },
  'dc': {
    name: 'Synopsys Design Compiler',
    repo: '',
    docs: 'https://www.synopsys.com/glossary/what-is-design-compiler.html',
    category: 'synthesis',
    desc: 'Industry-standard RTL synthesis tool. Transforms RTL to gate-level netlist with timing/area/power optimization.',
    alt: 'Cadence Genus',
    commercial: true,
  },
  'genus': {
    name: 'Cadence Genus Synthesis',
    repo: '',
    docs: 'https://www.cadence.com/en_US/home/tools/digital-signoff-and-synthesis/genus-synthesis-solution.html',
    category: 'synthesis',
    desc: 'High-performance RTL synthesis with starrc-based topographical mode.',
    alt: 'Synopsys Design Compiler',
    commercial: true,
  },
  'openroad': {
    name: 'OpenROAD',
    repo: 'The-OpenROAD-Project/OpenROAD',
    docs: 'https://openroad.readthedocs.io/en/latest/',
    category: 'physical-design',
    desc: 'Autonomous RTL-to-GDSII flow. Floorplan, placement, CTS, routing, STA.',
    alt: 'Cadence Innovus',
  },
  'openlane': {
    name: 'OpenLane',
    repo: 'The-OpenROAD-Project/OpenLane',
    docs: 'https://openlane.readthedocs.io/en/latest/',
    category: 'asic-flow',
    desc: 'Automated ASIC design flow from RTL to GDSII. Wraps Yosys + OpenROAD + KLayout.',
    alt: 'Commercial ASIC flow',
  },
  'librelane': {
    name: 'LibreLane',
    repo: 'librelane/librelane',
    docs: 'https://librelane.readthedocs.io/en/latest/',
    category: 'asic-flow',
    desc: 'Successor to OpenLane. Modular ASIC implementation flow infrastructure.',
    alt: 'Commercial ASIC flow',
  },
  'innovus': {
    name: 'Cadence Innovus',
    repo: '',
    docs: 'https://www.cadence.com/en_US/home/tools/digital-signoff-and-synthesis/innovus-implementation-system.html',
    category: 'physical-design',
    desc: 'Industry-standard P&R tool. Global/detailed placement, CTS (CCOpt), NanoRoute, timing optimization.',
    alt: 'Synopsys IC Compiler II',
    commercial: true,
  },
  'icc2': {
    name: 'Synopsys IC Compiler II',
    repo: '',
    docs: 'https://www.synopsys.com/glossary/what-is-ic-compiler.html',
    category: 'physical-design',
    desc: 'Next-gen physical design tool. Galaxy Place & Route, CTS, timing-driven optimisation.',
    alt: 'Cadence Innovus',
    commercial: true,
  },
  'opensta': {
    name: 'OpenSTA',
    repo: 'The-OpenROAD-Project/OpenSTA',
    docs: 'https://opensta.readthedocs.io/en/latest/',
    category: 'timing',
    desc: 'Gate-level static timing analysis engine. Reads Liberty, Verilog, SPEF, SDC.',
    alt: 'Synopsys PrimeTime',
  },
  'opentimer': {
    name: 'OpenTimer',
    repo: 'OpenTimer/OpenTimer',
    docs: 'https://github.com/OpenTimer/OpenTimer',
    category: 'timing',
    desc: 'High-performance timing analysis tool. Path-based and graph-based analysis.',
    alt: 'Synopsys PrimeTime',
  },
  'primetime': {
    name: 'Synopsys PrimeTime',
    repo: '',
    docs: 'https://www.synopsys.com/glossary/what-is-prime-time.html',
    category: 'timing',
    desc: 'Industry sign-off STA. Multi-corner/multi-mode (OCV/AOCV/SOCV), timing sign-off, power analysis.',
    alt: 'Cadence Tempus',
    commercial: true,
  },
  'tempus': {
    name: 'Cadence Tempus Timing',
    repo: '',
    docs: 'https://www.cadence.com/en_US/home/tools/digital-signoff-and-synthesis/tempus-timing-signoff-solution.html',
    category: 'timing',
    desc: 'Sign-off timing analysis. ECOpt-based timing closure, path-based analysis.',
    alt: 'Synopsys PrimeTime',
    commercial: true,
  },
  'verilator': {
    name: 'Verilator',
    repo: 'verilator/verilator',
    docs: 'https://www.veripool.org/verilator/',
    category: 'simulation',
    desc: 'Fastest Verilog/SystemVerilog simulator. 2-state cycle-accurate.',
    alt: 'Synopsys VCS',
  },
  'vcs': {
    name: 'Synopsys VCS',
    repo: '',
    docs: 'https://www.synopsys.com/verification/simulation/vcs.html',
    category: 'simulation',
    desc: 'Industry-leading Verilog/SystemVerilog/VHDL simulator. Full 4-state, UVM, coverage.',
    alt: 'Cadence Xcelium',
    commercial: true,
  },
  'xcelium': {
    name: 'Cadence Xcelium',
    repo: '',
    docs: 'https://www.cadence.com/en_US/home/tools/logical-simulation-platforms/xcelium-parallel-simulator.html',
    category: 'simulation',
    desc: 'Multi-language simulator. Native SystemVerilog, VHDL, Verilog-AMS.',
    alt: 'Synopsys VCS',
    commercial: true,
  },
  'iverilog': {
    name: 'Icarus Verilog',
    repo: 'steveicarus/iverilog',
    docs: 'https://steveicarus.github.io/iverilog/',
    category: 'simulation',
    desc: 'Lightweight Verilog simulator and synthesizer.',
    alt: 'Siemens Questa',
  },
  'klayout': {
    name: 'KLayout',
    repo: 'KLayout/klayout',
    docs: 'https://www.klayout.de/doc/',
    category: 'layout',
    desc: 'GDSII/OASIS layout viewer and editor. DRC/LVS via runsets.',
    alt: 'Cadence Virtuoso',
  },
  'magic': {
    name: 'Magic VLSI',
    repo: 'RTimothyEdwards/magic',
    docs: 'http://opencircuitdesign.com/magic/',
    category: 'layout',
    desc: 'Interactive layout editor with DRC extraction.',
    alt: 'Cadence Virtuoso',
  },
  'calibre': {
    name: 'Siemens Calibre',
    repo: '',
    docs: 'https://eda.com/products/calibre.html',
    category: 'verification',
    desc: 'Industry sign-off DRC/LVS/xRC. Metal fill, antenna, density checks.',
    alt: 'Synopsys IC Validator',
    commercial: true,
  },
  'icv': {
    name: 'Synopsys IC Validator',
    repo: '',
    docs: 'https://www.synopsys.com/glossary/what-is-ic-validator.html',
    category: 'verification',
    desc: 'DRC/LVS/ERC sign-off tool. StarRC integration for parasitic extraction.',
    alt: 'Siemens Calibre',
    commercial: true,
  },
  'netgen': {
    name: 'Netgen',
    repo: 'RTimothyEdwards/netgen',
    docs: 'http://opencircuitdesign.com/netgen/',
    category: 'verification',
    desc: 'LVS (Layout Versus Schematic) verification tool.',
    alt: 'Siemens Calibre LVS',
  },
  'abc': {
    name: 'ABC',
    repo: 'berkeley-abc/abc',
    docs: 'https://people.eecs.berkeley.edu/~alanmi/abc/',
    category: 'synthesis',
    desc: 'Logic synthesis and verification system. Boolean rewriting and mapping.',
    alt: 'Synopsys Design Compiler',
  },
  'lec': {
    name: 'Cadence Conformal LEC',
    repo: '',
    docs: 'https://www.cadence.com/en_US/home/tools/digital-signoff-and-synthesis/conformal-logic-equivalence-checking.html',
    category: 'equivalence',
    desc: 'Logic equivalence checking. Compares RTL vs gate-level vs physical netlist. Formally proves functional equivalence.',
    alt: 'Synopsys Formality',
    commercial: true,
  },
  'formality': {
    name: 'Synopsys Formality',
    repo: '',
    docs: 'https://www.synopsys.com/glossary/what-is-formality.html',
    category: 'equivalence',
    desc: 'Formal logic equivalence verification. Compares golden vs implementation netlists.',
    alt: 'Cadence Conformal LEC',
    commercial: true,
  },
  'conformal-eco': {
    name: 'Cadence Conformal ECO',
    repo: '',
    docs: 'https://www.cadence.com/en_US/home/tools/digital-signoff-and-synthesis/conformal-ec.html',
    category: 'eco',
    desc: 'Functional ECO implementation. Incremental netlist changes without full re-synthesis. Supports both functional and timing-driven ECO.',
    alt: 'Synopsys EC Synthesis',
    commercial: true,
  },
  'vivado': {
    name: 'Xilinx Vivado',
    repo: '',
    docs: 'https://www.xilinx.com/products/design-tools/vivado.html',
    category: 'fpga',
    desc: 'Xilinx/AMD FPGA synthesis, P&R, timing analysis, bitstream generation. Supports 7-series, UltraScale, Versal.',
    alt: 'Intel Quartus',
    commercial: true,
  },
  'quartus': {
    name: 'Intel Quartus Prime',
    repo: '',
    docs: 'https://www.intel.com/content/www/us/en/products/details/fpga/development-tools/quartus-prime.html',
    category: 'fpga',
    desc: 'Intel/Altera FPGA synthesis, P&R, timing analysis. Supports Stratix, Cyclone, MAX.',
    alt: 'Xilinx Vivado',
    commercial: true,
  },
  'nextpnr': {
    name: 'nextpnr',
    repo: 'YosysHQ/nextpnr',
    docs: 'https://github.com/YosysHQ/nextpnr',
    category: 'fpga-pnr',
    desc: 'Portable FPGA place-and-route tool.',
    alt: 'Xilinx Vivado',
  },
  'vtr': {
    name: 'VTR (Verilog-to-Routing)',
    repo: 'verilog-to-routing/vtr-verilog-to-routing',
    docs: 'https://verilog-to-routing.readthedocs.io/en/latest/',
    category: 'fpga-cad',
    desc: 'Academic FPGA CAD flow. Architecture exploration + place & route.',
    alt: 'Vendor FPGA tools',
  },
  'cocotb': {
    name: 'cocotb',
    repo: 'cocotb/cocotb',
    docs: 'https://cocotb.readthedocs.io/en/latest/',
    category: 'verification',
    desc: 'Coroutine-based cosimulation library for writing VHDL/Verilog testbenches in Python.',
    alt: 'UVM',
  },
  'symbiyosys': {
    name: 'SymbiYosys',
    repo: 'YosysHQ/SymbiYosys',
    docs: 'https://symbiyosys.readthedocs.io/en/latest/',
    category: 'formal',
    desc: 'Front-end for Yosys-based formal verification flows.',
    alt: 'Synopsys VC Formal',
  },
  'ghdl': {
    name: 'GHDL',
    repo: 'ghdl/ghdl',
    docs: 'https://ghdl.readthedocs.io/en/latest/',
    category: 'simulation',
    desc: 'VHDL simulator with full IEEE library support.',
    alt: 'Siemens Questa',
  },
  'questa': {
    name: 'Siemens Questa',
    repo: '',
    docs: 'https://eda.sw.siemens.com/en-US/ic/questa/',
    category: 'simulation',
    desc: 'Advanced functional verification platform. Multi-language (SV/VHDL/Verilog/UVM), formal+simulation integrated.',
    alt: 'Synopsys VCS',
    commercial: true,
  },
  'modelsim': {
    name: 'Intel ModelSim',
    repo: '',
    docs: 'https://www.intel.com/content/www/us/en/software-kit/750368/modelsim-intel-fpgas-standard-edition-software-version-18-1.html',
    category: 'simulation',
    desc: 'HDL simulation tool for functional verification. VHDL/Verilog/SystemVerilog.',
    alt: 'Siemens Questa',
    commercial: true,
  },
  'vc-formal': {
    name: 'Synopsys VC Formal',
    repo: '',
    docs: 'https://www.synopsys.com/verification/formal/vc-formal.html',
    category: 'formal',
    desc: 'Formal property verification. FPV, equivalence checking, formal-based connectivity.',
    alt: 'Cadence JasperGold',
    commercial: true,
  },
  'jaspergold': {
    name: 'Cadence JasperGold',
    repo: '',
    docs: 'https://www.cadence.com/en_US/home/tools/system-design-and-verification/formal-and-static-verification/jaspergold-verification-system.html',
    category: 'formal',
    desc: 'Formal verification platform. Property checking, equivalence checking, connectivity verification.',
    alt: 'Synopsys VC Formal',
    commercial: true,
  },
  'virtuoso': {
    name: 'Cadence Virtuoso',
    repo: '',
    docs: 'https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-custom-design-platform.html',
    category: 'analog-layout',
    desc: 'Full-custom IC design platform. Schematic entry, simulation (Spectre), layout (XL/GXL), DRC/LVS.',
    alt: 'Synopsys Custom Compiler',
    commercial: true,
  },
  'custom-compiler': {
    name: 'Synopsys Custom Compiler',
    repo: '',
    docs: 'https://www.synopsys.com/customic/custom-compiler.html',
    category: 'analog-layout',
    desc: 'Custom/analogue layout design environment. Schematic-driven layout, auto routing.',
    alt: 'Cadence Virtuoso',
    commercial: true,
  },
  'spyglass': {
    name: 'Synopsys SpyGlass',
    repo: '',
    docs: 'https://www.synopsys.com/verification/lint/spyglass.html',
    category: 'lint',
    desc: 'RTL lint/CDC/RDC analysis. Design rule checking, clock domain crossing, reset domain crossing.',
    alt: 'Cadence HAL',
    commercial: true,
  },
  'dft-compiler': {
    name: 'Synopsys DFT Compiler',
    repo: '',
    docs: 'https://www.synopsys.com/dft/dft-compiler.html',
    category: 'dft',
    desc: 'Design-for-Test insertion. Scan chain, ATPG, BIST, boundary scan (IEEE 1149.1).',
    alt: 'Cadence Modus',
    commercial: true,
  },
  'modus': {
    name: 'Cadence Modus DFT',
    repo: '',
    docs: 'https://www.cadence.com/en_US/home/tools/digital-signoff-and-synthesis/modus-dft-solution.html',
    category: 'dft',
    desc: 'DFT insertion and test. Scan synthesis, ATPG, compression, BIST.',
    alt: 'Synopsys DFT Compiler',
    commercial: true,
  },
  'synplify': {
    name: 'Synopsys Synplify',
    repo: '',
    docs: 'https://www.synopsys.com/fpga/synplify.html',
    category: 'fpga-synthesis',
    desc: 'FPGA synthesis tool. Supports Xilinx, Intel/Altera, Lattice, Microchip FPGAs.',
    alt: 'Vendor FPGA synthesis',
    commercial: true,
  },
  'diamond': {
    name: 'Lattice Diamond',
    repo: '',
    docs: 'https://www.latticesemi.com/products/designsoftwareandip/tools2/fpgadesignsoftware/diamond',
    category: 'fpga',
    desc: 'Lattice FPGA design suite. Synthesis, P&R, timing analysis for ECP5, Nexus, CertusPro.',
    alt: 'Xilinx Vivado',
    commercial: true,
  },
  'redhawk': {
    name: 'ANSYS RedHawk',
    repo: '',
    docs: 'https://www.ansys.com/products/semiconductors/ansys-redhawk',
    category: 'power-integrity',
    desc: 'Power integrity and EM/ESD analysis. On-chip power grid, IR drop, electromigration.',
    alt: 'Synopsys Totem',
    commercial: true,
  },
  'totem': {
    name: 'Synopsys Totem',
    repo: '',
    docs: 'https://www.synopsys.com/implementation-solution/power-analysis/totem.html',
    category: 'power-integrity',
    desc: 'Full-chip power integrity. IR drop, EM, ESD, thermal analysis for custom/digital designs.',
    alt: 'ANSYS RedHawk',
    commercial: true,
  },
  'prime-time-si': {
    name: 'Synopsys PrimeTime SI',
    repo: '',
    docs: 'https://www.synopsys.com/glossary/what-is-prime-time.html',
    category: 'signal-integrity',
    desc: 'Signal integrity analysis. Crosstalk-induced delay, noise, glitches. Sign-off SI.',
    alt: 'Cadence Tempus SI',
    commercial: true,
  },
  'tempus-si': {
    name: 'Cadence Tempus SI',
    repo: '',
    docs: 'https://www.cadence.com/en_US/home/tools/digital-signoff-and-synthesis/tempus-timing-signoff-solution.html',
    category: 'signal-integrity',
    desc: 'Sign-off signal integrity. Crosstalk analysis, noise budget, SI-driven optimisation.',
    alt: 'Synopsys PrimeTime SI',
    commercial: true,
  },
  'hal': {
    name: 'Cadence HAL',
    repo: '',
    docs: 'https://www.cadence.com/en_US/home/tools/system-design-and-verification/systemc-and-tlm-tools/hal.html',
    category: 'lint',
    desc: 'RTL lint and CDC analysis. Design rule checks, semantic checks, clock domain crossing.',
    alt: 'Synopsys SpyGlass',
    commercial: true,
  },
  'ieee-1149': {
    name: 'IEEE 1149.1 (JTAG)',
    repo: '',
    docs: '',
    category: 'test',
    desc: 'Standard for boundary scan test access. Used by DFT tools (DFT Compiler, Modus) for chip-level test.',
    alt: 'IEEE 1500',
  },
  'ieee-1500': {
    name: 'IEEE 1500 (WIF)',
    repo: '',
    docs: '',
    category: 'test',
    desc: 'Standard for embedded core test. Wrapper serial/parallel interface for IP core test.',
    alt: 'IEEE 1149.1',
  },
  'ieda': {
    name: 'iEDA',
    repo: '1016667086/iEDA',
    docs: 'https://ieda.oscc.cc/en/',
    category: 'physical-design',
    desc: 'Open-source EDA infrastructure and tools from Netlist to GDS.',
    alt: 'Commercial EDA suite',
  },
  'starrc': {
    name: 'Synopsys StarRC',
    repo: '',
    docs: 'https://www.synopsys.com/glossary/what-is-star-rc.html',
    category: 'extraction',
    desc: 'Parasitic extraction tool. Extracts RC parasitics from layout for sign-off STA.',
    alt: 'Cadence Quantus',
    commercial: true,
  },
  'quantus': {
    name: 'Cadence Quantus QRC',
    repo: '',
    docs: 'https://www.cadence.com/en_US/home/tools/digital-signoff-and-synthesis/quantus-extraction-solution.html',
    category: 'extraction',
    desc: 'Parasitic extraction. QRC technology for accurate RC modelling.',
    alt: 'Synopsys StarRC',
    commercial: true,
  },
  'voltus': {
    name: 'Cadence Voltus',
    repo: '',
    docs: 'https://www.cadence.com/en_US/home/tools/digital-signoff-and-synthesis/voltus-ic-power-signoff-solution.html',
    category: 'power',
    desc: 'Power sign-off. IR drop analysis, EM/ESD checks, dynamic/static power.',
    alt: 'Synopsys PrimePower',
    commercial: true,
  },
  'primepower': {
    name: 'Synopsys PrimePower',
    repo: '',
    docs: 'https://www.synopsys.com/glossary/what-is-primepower.html',
    category: 'power',
    desc: 'Gate-level power analysis. Vector-based and vectorless power estimation.',
    alt: 'Cadence Voltus',
    commercial: true,
  },
};

// ── PDK 快速索引 ─────────────────────────────────────────────────────────────
const PDK_INDEX = {
  'sky130': {
    name: 'SkyWater SKY130',
    repo: 'google/skywater-pdk',
    node: '130nm CMOS',
    type: '可量產',
    foundry: 'SkyWater Technology',
    pythonPkg: 'skywater-pdk',
    cells: ['sky130_fd_sc_hd', 'sky130_fd_sc_hdll', 'sky130_fd_sc_hs', 'sky130_fd_sc_ms', 'sky130_fd_sc_ls', 'sky130_fd_sc_lp', 'sky130_fd_sc_hvl'],
    desc: 'Google + SkyWater 開源 PDK，Apache 2.0 授權。可實際 tape-out。',
  },
  'asap7': {
    name: 'ASAP7',
    repo: 'The-OpenROAD-Project/asap7',
    node: '7nm FinFET (預測性)',
    type: '學術研究',
    foundry: 'Arizona State Univ + ARM',
    cells: ['asap7sc7p5t_28', 'asap7sc6t_26'],
    desc: 'Predictive 7nm FinFET PDK。4 種 V_T flavor (SLVT/LVT/RVT/SRAM)。不可量產。',
  },
  'gf180': {
    name: 'GF180MCU',
    repo: 'google/gf180mcu-pdk',
    node: '180nm',
    type: '可量產',
    foundry: 'GlobalFoundries',
    desc: 'Google + GlobalFoundries 開源 PDK。',
  },
  'nangate45': {
    name: 'Nangate45',
    repo: 'Nangate/open_cell_library',
    node: '45nm',
    type: '學術研究',
    foundry: 'Nangate (已關閉)',
    desc: 'Free standard cell library for 45nm. Non-commercial use.',
  },
  'ihp130': {
    name: 'IHP SG13G2',
    repo: 'IHP-GmbH/IHP-Open-PDK',
    node: '130nm BiCMOS',
    type: '可量產',
    foundry: 'IHP GmbH',
    desc: 'SiGe BiCMOS PDK，支援 RF/混合訊號設計。',
  },
  'freepdk3': {
    name: 'FreePDK3',
    repo: 'ncsu-eda/FreePDK3',
    node: '3nm (預測性)',
    type: '學術研究',
    foundry: 'NC State + Synopsys',
    desc: 'Predictive 3nm PDK。搭配 Synopsys Custom Compiler。',
  },
  'tr1um': {
    name: 'TR-1um',
    repo: 'OpenSUSI/TR-1um',
    node: '1um CMOS',
    type: '可量產',
    foundry: 'Tokai Rika',
    desc: '日本 NDA-free 1um CMOS PDK。',
  },
};

// ── EDA 關鍵會議 ─────────────────────────────────────────────────────────────
const EDA_CONFERENCES = [
  'DAC',           // Design Automation Conference
  'ICCAD',         // International Conference on Computer-Aided Design
  'ISPD',          // International Symposium on Physical Design
  'DATE',          // Design, Automation & Test in Europe
  'ASP-DAC',       // Asia and South Pacific Design Automation Conference
  'VLSI Symposium',// IEEE Symposium on VLSI Technology and Circuits
  'ISSCC',         // International Solid-State Circuits Conference
  'IEDM',          // International Electron Devices Meeting
  'TCAD',          // IEEE Transactions on Computer-Aided Design
];

// ═══════════════════════════════════════════════════════════════════════════════
// Cell-Based Flow 完整知識庫
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cell-Based Design Flow 各階段的工具與命令對照表
 * Stage → Tool → Commands
 */
const CELL_FLOW_STAGES = {
  '1-rtl': {
    name: 'RTL Design',
    desc: '以硬體描述語言（Verilog/SystemVerilog/VHDL）撰寫暫存器轉移層級設計',
    inputs: ['RTL code (.v/.sv/.vhd)', 'Constraints (.sdc)'],
    outputs: ['Verified RTL'],
    tools: {
      'Yosys': {
        category: 'synthesis',
        commands: [
          { cmd: 'read_verilog <file.v>', desc: '讀取 Verilog 設計' },
          { cmd: 'read_systemverilog <file.sv>', desc: '讀取 SystemVerilog 設計' },
          { cmd: 'hierarchy -top <module>', desc: '設定頂層模組' },
          { cmd: 'proc', desc: '處理 process（always/initial）' },
          { cmd: 'opt', desc: '最佳化' },
          { cmd: 'stat', desc: '顯示設計統計資訊' },
        ],
      },
      'Verilator': {
        category: 'simulation',
        commands: [
          { cmd: 'verilator --cc <file.v> --exe <tb.cpp>', desc: '編譯 Verilog 為 C++ model' },
          { cmd: 'verilator --lint-only <file.v>', desc: '僅做 lint 檢查' },
          { cmd: 'verilator --trace <file.v>', desc: '啟用波形追蹤' },
        ],
      },
      'Icarus Verilog': {
        category: 'simulation',
        commands: [
          { cmd: 'iverilog -o <out> <file.v> <tb.v>', desc: '編譯 Verilog' },
          { cmd: 'vvp <out>', desc: '執行模擬' },
          { cmd: 'iverilog -g2012 -o <out> <file.sv>', desc: '編譯 SystemVerilog (2012)' },
        ],
      },
      'cocotb': {
        category: 'verification',
        commands: [
          { cmd: 'pytest --cocotb <test.py>', desc: '執行 cocotb 測試' },
          { cmd: 'make SIM=verilator', desc: '使用 Verilator 後端模擬' },
        ],
      },
      'SymbiYosys': {
        category: 'formal',
        commands: [
          { cmd: 'sby -f <task.sby>', desc: '執行 formal verification' },
          { cmd: 'sby -f <task.sby> bmc', desc: 'Bounded model checking' },
          { cmd: 'sby -f <task.sby> prove', desc: 'Unbounded proof' },
        ],
      },
      'Synopsys SpyGlass': {
        category: 'lint',
        commands: [
          { cmd: 'read_file -type verilog <files>', desc: '讀取 Verilog 原始碼' },
          { cmd: 'set_option top <module>', desc: '設定頂層模組' },
          { cmd: 'set_option enableSV <on>', desc: '啟用 SystemVerilog 支援' },
          { cmd: 'run_goal lint/lint_rtl', desc: '執行 RTL lint 檢查' },
          { cmd: 'run_goal lint/lint_turbo_rtl', desc: '快速 RTL lint' },
          { cmd: 'run_goal cdc/cdc', desc: '執行 CDC (Clock Domain Crossing) 檢查' },
          { cmd: 'run_goal rdc/rdc', desc: '執行 RDC (Reset Domain Crossing) 檢查' },
          { cmd: 'run_goal adv_lint/adv_lint', desc: '進階 lint 檢查' },
          { cmd: 'report_goal_results <goal>', desc: '報告目標結果' },
        ],
      },
      'Cadence HAL': {
        category: 'lint',
        commands: [
          { cmd: 'hal -sv <files>', desc: '執行 SystemVerilog lint' },
          { cmd: 'hal -verilog <files>', desc: '執行 Verilog lint' },
          { cmd: 'hal -cdc <files>', desc: '執行 CDC 檢查' },
        ],
      },
    },
  },

  '1.5-dft': {
    name: 'Design-for-Test (DFT)',
    desc: '在合成後插入測試結構：scan chain、BIST、boundary scan (IEEE 1149.1)',
    inputs: ['Gate-level netlist (post-synthesis)', 'Liberty (.lib)', 'Test specifications'],
    outputs: ['DFT-inserted netlist', 'ATPG patterns (.pat)', 'Test coverage report'],
    tools: {
      'Synopsys DFT Compiler': {
        category: 'dft',
        commands: [
          { cmd: 'set_scan_style -scan_compression', desc: '設定 scan compression 模式' },
          { cmd: 'set_scan_compress_depth <value>', desc: '設定壓縮深度' },
          { cmd: 'set_dft_signal -view existing_dft -port <scan_enable>', desc: '設定 scan enable port' },
          { cmd: 'set_dft_signal -view existing_dft -port <scan_data_in> -type ScanDataIn', desc: '設定 scan data in port' },
          { cmd: 'set_dft_signal -view existing_dft -port <scan_data_out> -type ScanDataOut', desc: '設定 scan data out port' },
          { cmd: 'set_scan_path -signal <scan_in> -cell <scan_cell>', desc: '設定 scan path' },
          { cmd: 'check_dft_rules', desc: '檢查 DFT 規則' },
          { cmd: 'preview_dft -show_scan_summary', desc: '預覽 DFT 結果摘要' },
          { cmd: 'insert_dft', desc: '插入 DFT 結構（scan chain）' },
          { cmd: 'write -format verilog -hierarchy -output <dft_netlist.v>', desc: '輸出 DFT netlist' },
          { cmd: 'report_scan_path -summary', desc: '報告 scan path 摘要' },
          { cmd: 'report_dft_clocks', desc: '報告 DFT 時脈' },
        ],
      },
      'Cadence Modus DFT': {
        category: 'dft',
        commands: [
          { cmd: 'set_db dft_scan_style scan_compression', desc: '設定 scan compression 風格' },
          { cmd: 'set_db dft_scan_compress_depth <value>', desc: '設定壓縮深度' },
          { cmd: 'set_db dft_bist_clock <port>', desc: '設定 BIST 時脈' },
          { cmd: 'set_db dft_bist_mode <mode>', desc: '設定 BIST 模式' },
          { cmd: 'set_db dftInsertion true', desc: '啟用 DFT insertion' },
          { cmd: 'report_dft_rules', desc: '報告 DFT 規則檢查' },
          { cmd: 'report_scan_path -summary', desc: '報告 scan path 摘要' },
          { cmd: 'write_design -innovus -gzip -basename <design>', desc: '輸出 Innovus 格式 netlist' },
        ],
      },
    },
  },

  '2-synthesis': {
    name: 'Logic Synthesis',
    desc: '將 RTL 程式碼轉換為閘級網表（gate-level netlist），同時進行邏輯最佳化',
    inputs: ['RTL code', 'Liberty file (.lib)', 'SDC constraints'],
    outputs: ['Gate-level netlist (.v/.blif)', 'Area/timing report'],
    tools: {
      'Yosys': {
        category: 'synthesis',
        commands: [
          { cmd: 'read_verilog <file.v>', desc: '讀取 RTL' },
          { cmd: 'read_liberty -liberty <cell.lib>', desc: '讀取 cell library (Liberty)' },
          { cmd: 'hierarchy -top <module>', desc: '設定頂層模組' },
          { cmd: 'synth -top <module>', desc: '執行 RTL 合成（通用）' },
          { cmd: 'synth -top <module> -flatten', desc: '合成並扁平化' },
          { cmd: 'abc -liberty <cell.lib>', desc: '使用 ABC 做 technology mapping' },
          { cmd: 'opt', desc: '邏輯最佳化' },
          { cmd: 'opt_clean -purge', desc: '清除未使用的邏輯' },
          { cmd: 'stat -liberty <cell.lib>', desc: '報告面積/cell 數量' },
          { cmd: 'write_verilog <netlist.v>', desc: '輸出閘級網表' },
          { cmd: 'write_blif <netlist.blif>', desc: '輸出 BLIF 格式' },
          { cmd: 'write_json <netlist.json>', desc: '輸出 JSON 格式' },
          // FPGA 特定
          { cmd: 'synth_ice40', desc: '合成到 iCE40 FPGA' },
          { cmd: 'synth_xilinx', desc: '合成到 Xilinx FPGA' },
          { cmd: 'synth_ecp5', desc: '合成到 Lattice ECP5 FPGA' },
        ],
      },
      'ABC': {
        category: 'synthesis',
        commands: [
          { cmd: 'read_blif <netlist.blif>', desc: '讀取 BLIF 網表' },
          { cmd: 'read_verilog <netlist.v>', desc: '讀取 Verilog' },
          { cmd: 'read_library <cell.lib>', desc: '讀取 Liberty library' },
          { cmd: 'read_aiger <file.aig>', desc: '讀取 AIG 格式' },
          { cmd: 'map -F 5 -N 10 <cell.lib>', desc: 'Technology mapping' },
          { cmd: 'resyn', desc: '標準優化流程' },
          { cmd: 'resyn2', desc: '進階優化流程' },
          { cmd: 'resyn3', desc: '額外優化流程' },
          { cmd: 'ifraig', desc: 'Iterative FAIG rewriting + refactoring' },
          { cmd: 'dc2', desc: "Don't-care-based optimization" },
          { cmd: 'strash', desc: 'Structural hashing to AIG' },
          { cmd: 'refactor', desc: 'Boolean refactoring' },
          { cmd: 'rewrite', desc: 'Boolean rewriting' },
          { cmd: 'map', desc: 'Technology mapping' },
          { cmd: 'print_stats', desc: '報告 AIG 統計' },
          { cmd: 'write_blif <out.blif>', desc: '輸出 BLIF' },
          { cmd: 'write_verilog <out.v>', desc: '輸出 Verilog' },
        ],
      },
      'Synopsys DC': {
        category: 'synthesis',
        commands: [
          { cmd: 'analyze -format verilog <files>', desc: '分析 RTL 原始碼' },
          { cmd: 'elaborate <module>', desc: '展開設計' },
          { cmd: 'link', desc: '連結 design 與 library' },
          { cmd: 'uniquify', desc: '唯一化 design instance' },
          { cmd: 'set_clock -name <clk> -period <ns> [get_ports <port>]', desc: '定義時脈約束' },
          { cmd: 'set_input_delay <ns> -clock <clk> [get_ports <port>]', desc: '設定輸入延遲' },
          { cmd: 'set_output_delay <ns> -clock <clk> [get_ports <port>]', desc: '設定輸出延遲' },
          { cmd: 'set_max_area <um2>', desc: '設定最大面積限制' },
          { cmd: 'compile_ultra', desc: '進階合成（最常用）' },
          { cmd: 'compile -map_effort high', desc: '高 effort 合成' },
          { cmd: 'report_timing', desc: '報告時序' },
          { cmd: 'report_area', desc: '報告面積' },
          { cmd: 'report_power', desc: '報告功耗' },
          { cmd: 'report_reference -hierarchy', desc: '報告 cell 使用統計' },
          { cmd: 'write -format verilog -hierarchy -output <netlist.v>', desc: '輸出閘級網表' },
          { cmd: 'write_sdc <design.sdc>', desc: '輸出 SDC 約束' },
          { cmd: 'write_sdf <design.sdf>', desc: '輸出 SDF timing' },
          { cmd: 'write_script > <script.tcl>', desc: '輸出合成腳本' },
        ],
      },
      'Cadence Genus': {
        category: 'synthesis',
        commands: [
          { cmd: 'set_db lib_search_path <path>', desc: '設定 library 搜尋路徑' },
          { cmd: 'read_libs <cell.lib>', desc: '讀取 Liberty library' },
          { cmd: 'read_verilog <file.v>', desc: '讀取 RTL' },
          { cmd: 'set_top <module>', desc: '設定頂層模組' },
          { cmd: 'syn_generic', desc: 'Generic synthesis' },
          { cmd: 'syn_map', desc: 'Technology mapping' },
          { cmd: 'syn_opt', desc: '優化' },
          { cmd: 'report_timing', desc: '報告時序' },
          { cmd: 'report_area', desc: '報告面積' },
          { cmd: 'write_netlist <netlist.v>', desc: '輸出網表' },
          { cmd: 'write_sdc <design.sdc>', desc: '輸出 SDC' },
        ],
      },
    },
  },

  '3-floorplan': {
    name: 'Floorplanning',
    desc: '定義晶片邊界、放置 I/O pins、規劃 power grid、設定 placement density',
    inputs: ['Gate-level netlist', 'Liberty (.lib)', 'LEF (.lef)', 'SDC', 'FP constraints'],
    outputs: ['Initial floorplan (.def/.odb)', 'Power grid design'],
    tools: {
      'OpenROAD': {
        category: 'physical-design',
        commands: [
          { cmd: 'read_lef <tech.lef>', desc: '讀取技術 LEF' },
          { cmd: 'read_lef <stdcell.lef>', desc: '讀取 standard cell LEF' },
          { cmd: 'read_liberty <cell.lib>', desc: '讀取 Liberty library' },
          { cmd: 'read_verilog <netlist.v>', desc: '讀取閘級網表' },
          { cmd: 'read_sdc <design.sdc>', desc: '讀取 SDC 約束' },
          { cmd: 'init_floorplan -die_area "0 0 <W> <H>" -core_utilization <0-1> -core_margins_by die', desc: '初始化 floorplan' },
          { cmd: 'place_pins -hor_layers M2 -ver_layers M3', desc: '放置 I/O pins' },
          { cmd: 'add_io_ring -distance <um> -layers {M1 M2 M3 M4}', desc: '添加 I/O ring' },
          { cmd: 'init_power_grid -layers {M7 M8} -pitch <um>', desc: '初始化 power grid' },
          { cmd: 'report_design_area', desc: '報告面積' },
          { cmd: 'check_design -pre_floorplan', desc: 'Floorplan 前檢查' },
        ],
      },
      'Innovus': {
        category: 'physical-design',
        commands: [
          { cmd: 'set design <name>', desc: '設定 design 名稱' },
          { cmd: 'set init_verilog <netlist.v>', desc: '設定閘級網表路徑' },
          { cmd: 'set init_top_netlist <module>', desc: '設定頂層模組' },
          { cmd: 'set init_mmmc_file <mmmc.tcl>', desc: '設定 MMMC timing constraint' },
          { cmd: 'set init_lef_file "<tech.lef> <stdcell.lef>"', desc: '設定 LEF 檔案' },
          { cmd: 'init_design', desc: '初始化 design' },
          { cmd: 'floorPlan -site <site_name> -r 1 <W> <H> <margin> <margin> <margin> <margin>', desc: '建立 floorplan' },
          { cmd: 'floorPlan -site <site_name> -d <W> <H> <margin> <margin> <margin> <margin>', desc: '以 die 尺寸建立' },
          { cmd: 'addRing -nets {VDD VSS} -width 2 -spacing 1 -layer {M8 M9}', desc: '添加 power ring' },
          { cmd: 'addStripe -nets {VDD VSS} -width 1.8 -spacing 0.5 -set_to_set_distance 40 -layer M8', desc: '添加 power stripe' },
          { cmd: 'addWellTap -cell <tapcell> -cellInterval 30 -prefix FILLTAP', desc: '添加 welltap cell' },
          { cmd: 'editPad -pin <pad> -assign <x:y>', desc: '手動放置 I/O pad' },
          { cmd: 'report_design -physical', desc: '報告 physical 資訊' },
          { cmd: 'checkFPlan -reportUtil', desc: '檢查 floorplan utilization' },
        ],
      },
    },
  },

  '4-placement': {
    name: 'Placement',
    desc: '將標準自動放置到 floorplan 規劃的區域內，同時考慮 congestion 和 timing',
    inputs: ['Floorplan (.def/.odb)', 'Netlist', 'SDC', 'Liberty'],
    outputs: ['Placed design (.def/.odb)', 'Placement report'],
    tools: {
      'OpenROAD': {
        category: 'physical-design',
        commands: [
          { cmd: 'global_placement -timing_driven -density <0-1>', desc: '全域放置（timing-driven）' },
          { cmd: 'global_placement -skip_initial_place', desc: '跳過初始放置直接優化' },
          { cmd: 'detailed_placement', desc: '詳細放置（legalize + 數微調）' },
          { cmd: 'optimize_placement', desc: '最佳化 placement' },
          { cmd: 'filler_placement <prefix> <cells>', desc: '插入 filler cell' },
          { cmd: 'report_placement_utilization', desc: '報告 placement utilization' },
          { cmd: 'report_congesting -overflow', desc: '報告 congestion' },
          { cmd: 'check_design -pre_place', desc: 'Place 前檢查' },
        ],
      },
      'Innovus': {
        category: 'physical-design',
        commands: [
          { cmd: 'setPlaceMode -timingDriven true -congEffort high', desc: '設定 placement mode' },
          { cmd: 'setDesignMode -flowEffort high', desc: '設定 flow effort' },
          { cmd: 'place_design -timingDriven', desc: '執行 placement（timing-driven）' },
          { cmd: 'place_design -noPrePlaceOpt', desc: 'placement 不含 pre-placement 優化' },
          { cmd: 'setPlaceMode -earlyPlaceMaxHeight <cells>', desc: '限制 early placement 高度' },
          { cmd: 'refinePlace', desc: 'Refine placement' },
          { cmd: 'checkPlace', desc: '檢查 placement 合法性' },
          { cmd: 'report_design -physical', desc: '報告 physical 資訊' },
          { cmd: 'reportCongestion -hotSpot', desc: '報告 congestion hotspot' },
          { cmd: 'ecoPlace', desc: 'ECO placement' },
        ],
      },
    },
  },

  '5-cts': {
    name: 'Clock Tree Synthesis (CTS)',
    desc: '建立低偏斜（skew）的時脈分配網路，插入 buffer/inverter 以驅動高 fanout 時脈 net',
    inputs: ['Placed design', 'Clock constraints (SDC)', 'Liberty'],
    outputs: ['CTS design (.def/.odb)', 'Clock tree report'],
    tools: {
      'OpenROAD': {
        category: 'physical-design',
        commands: [
          { cmd: 'clock_tree_synthesis -root_buf <buf_cell> -buf_list <buf_cells> -clk_buf_in_clk_port <port>', desc: '執行 CTS（最常用）' },
          { cmd: 'clock_tree_synthesis -root_buf BUF_X4 -buf_list {BUF_X2 BUF_X4 BUF_X8} -sink_clustering_enable', desc: '含 sink clustering 的 CTS' },
          { cmd: 'report_clock_timing -type summary', desc: '報告時脈樹摘要' },
          { cmd: 'report_clock_timing -type latency', desc: '報告時脈延遲' },
          { cmd: 'report_clock_skew', desc: '報告 clock skew' },
          { cmd: 'check_design -pre_cts', desc: 'CTS 前檢查' },
          { cmd: 'set_clock_latency -source <ns>', desc: '設定 source latency' },
        ],
      },
      'Innovus': {
        category: 'physical-design',
        commands: [
          { cmd: 'set_ccopt_property target_max_trans <ns>', desc: '設定最大 transition' },
          { cmd: 'set_ccopt_property target_skew <ns>', desc: '設定 target skew' },
          { cmd: 'set_ccopt_property buffer_cells {CLKBUF_X2 CLKBUF_X4 CLKBUF_X8}', desc: '設定 CTS buffer cells' },
          { cmd: 'set_ccopt_property inverter_cells {CLKINV_X2 CLKINV_X4 CLKINV_X8}', desc: '設定 CTS inverter cells' },
          { cmd: 'ccopt_design', desc: '執行 CTS（最常用）' },
          { cmd: 'report_ccopt_clock_trees -summary', desc: '報告時脈樹摘要' },
          { cmd: 'report_ccopt_skew_groups -summary', desc: '報告 skew groups' },
          { cmd: 'setAnalysisMode -analysisType onChipVariation', desc: '設定 OCV 分析模式' },
        ],
      },
    },
  },

  '6-routing': {
    name: 'Routing',
    desc: '根據 placement 和 CTS 結果，實際佈線連接所有 cell 和 macro',
    inputs: ['CTS design (.def/.odb)', 'Netlist', 'Technology LEF (含 routing rules)'],
    outputs: ['Routed design (.def/.odb)', 'DRC-clean routing'],
    tools: {
      'OpenROAD': {
        category: 'physical-design',
        commands: [
          { cmd: 'set_global_routing_layer_adjustment <layer> <factor>', desc: '設定 routing layer 調整因子' },
          { cmd: 'global_route -allow_congestion', desc: '全域路由（允許 congestion）' },
          { cmd: 'global_route', desc: '全域路由（預設）' },
          { cmd: 'detailed_route -repair_row_height', desc: '詳細路由（修復 row height）' },
          { cmd: 'detailed_route', desc: '詳細路由（預設）' },
          { cmd: 'antenna_repair', desc: '修復 antenna violation' },
          { cmd: 'filler_placement <prefix> <cells>', desc: 'Routing 後插入 filler' },
          { cmd: 'report_drc', desc: '報告 DRC violation' },
          { cmd: 'report_net_routing_layers', desc: '報告 routing layer 使用' },
          { cmd: 'check_design -pre_route', desc: 'Route 前檢查' },
          { cmd: 'set_wire_rc -signal -layer M3', desc: '設定 wire RC model' },
          { cmd: 'set_wire_rc -clock -layer M4', desc: '設定 clock wire RC model' },
        ],
      },
      'Innovus': {
        category: 'physical-design',
        commands: [
          { cmd: 'setNanoRouteMode -routeWithTimingDriven true', desc: '啟用 timing-driven routing' },
          { cmd: 'setNanoRouteMode -routeWithEco true', desc: '啟用 ECO routing' },
          { cmd: 'setNanoRouteMode -routeWithSiDriven true', desc: '啟用 SI-driven routing' },
          { cmd: 'routeDesign -globalDetail', desc: '執行全域+詳細 routing' },
          { cmd: 'routeDesign -viaOpt -wireOpt', desc: 'Routing + via/wire 優化' },
          { cmd: 'ecoRoute', desc: 'ECO routing' },
          { cmd: 'verify_drc', desc: '執行 DRC 檢查' },
          { cmd: 'reportVio -summary', desc: '報告 violation 摘要' },
          { cmd: 'setExtractRCMode -engine postRoute', desc: '設定 post-route RC extraction' },
          { cmd: 'extractRC', desc: '執行 RC extraction' },
          { cmd: 'setAnalysisMode -analysisType onChipVariation', desc: '設定 OCV 分析' },
          { cmd: 'timeDesign -postRoute', desc: 'Post-route timing report' },
          { cmd: 'optDesign -postRoute', desc: 'Post-route timing optimization' },
        ],
      },
    },
  },

  '7-signoff': {
    name: 'Sign-off Verification',
    desc: '最終驗證：STA、DRC、LVS、power analysis、IR drop、EM 檢查',
    inputs: ['Routed design (.def/.odb)', 'SPEF (parasitics)', 'Liberty (.lib)', 'SDC'],
    outputs: ['Sign-off report', 'GDSII', 'Final netlist'],
    tools: {
      'OpenSTA': {
        category: 'timing',
        commands: [
          { cmd: 'read_lef <tech.lef>', desc: '讀取技術 LEF' },
          { cmd: 'read_def <design.def>', desc: '讀取設計 DEF' },
          { cmd: 'read_liberty <cell.lib>', desc: '讀取 Liberty library' },
          { cmd: 'read_sdc <design.sdc>', desc: '讀取 SDC 約束' },
          { cmd: 'read_spef <design.spef>', desc: '讀取 SPEF parasitics' },
          { cmd: 'report_timing -max_paths 10', desc: '報告最差 10 條路徑' },
          { cmd: 'report_timing -path_type summary', desc: '報告 timing 摘要' },
          { cmd: 'report_checks -delay_type max', desc: '報告 setup violation' },
          { cmd: 'report_checks -delay_type min', desc: '報告 hold violation' },
          { cmd: 'report_clock_skew', desc: '報告 clock skew' },
          { cmd: 'report_design', desc: '報告 design 摘要' },
          { cmd: 'report_wns', desc: '報告 worst negative slack' },
          { cmd: 'report_tns', desc: '報告 total negative slack' },
          { cmd: 'report_power', desc: '報告功耗' },
          { cmd: 'report_constraint_modes', desc: '報告 constraint modes' },
          { cmd: 'report_analysis_types', desc: '報告分析類型' },
        ],
      },
      'KLayout': {
        category: 'layout',
        commands: [
          { cmd: 'klayout -b -r <script.py> -r <gds>', desc: '執行 KLayout Python script' },
          { cmd: 'klayout -b -r drc.lydrc <gds>', desc: '執行 DRC' },
          { cmd: 'klayout -b -r lvs.lylvs <gds>', desc: '執行 LVS' },
          { cmd: 'klayout -z <gds>', desc: 'GUI 模式開啟 GDS' },
        ],
      },
      'Magic VLSI': {
        category: 'layout',
        commands: [
          { cmd: 'magic -dnull <tech_file> <gds>', desc: '以 CLI 模式開啟 GDS' },
          { cmd: 'drc check', desc: '執行 DRC' },
          { cmd: 'extract all', desc: '執行 parasitic extraction' },
          { cmd: 'ext2spice -o <out.spice>', desc: '轉換為 SPICE netlist' },
          { cmd: 'lvs', desc: '執行 LVS 檢查' },
          { cmd: 'gds read <file.gds>', desc: '讀取 GDS 檔案' },
          { cmd: 'gds write <file.gds>', desc: '寫出 GDS 檔案' },
        ],
      },
      'Netgen': {
        category: 'verification',
        commands: [
          { cmd: 'netgen -batch lvs "<layout.spice> <schematic.spice>" <output>', desc: '執行 LVS' },
          { cmd: 'netgen -batch lvs "<layout.spice> <schematic.spice>" -exclude <cell>', desc: 'LVS with exclusions' },
        ],
      },
      'OpenRCX': {
        category: 'extraction',
        commands: [
          { cmd: 'extract_parasitics -spef_file <out.spef>', desc: '提取 SPEF parasitics' },
          { cmd: 'set_process <value>', desc: '設定 process factor' },
          { cmd: 'set_temperature <value>', desc: '設定溫度' },
        ],
      },
      'StarRC': {
        category: 'extraction',
        commands: [
          { cmd: 'STARXTRACT <layout.gds> <netlist.spice> <output.spef> <runset>', desc: '執行 RC extraction' },
        ],
      },
      'Synopsys PrimeTime': {
        category: 'timing',
        commands: [
          { cmd: 'read_verilog <netlist.v>', desc: '讀取閘級網表' },
          { cmd: 'read_liberty <cell.lib>', desc: '讀取 Liberty library' },
          { cmd: 'read_sdc <design.sdc>', desc: '讀取 SDC 約束' },
          { cmd: 'read_spef <design.spef>', desc: '讀取 SPEF parasitics' },
          { cmd: 'current_design <module>', desc: '設定目前 design' },
          { cmd: 'set_operating_conditions <corner>', desc: '設定操作條件 (process/voltage/temp)' },
          { cmd: 'set_timing_derate -late <factor>', desc: '設定 OCV derate (late path)' },
          { cmd: 'set_timing_derate -early <factor>', desc: '設定 OCV derate (early path)' },
          { cmd: 'set_clock_uncertainty <ns> [get_clocks <clk>]', desc: '設定 clock uncertainty' },
          { cmd: 'report_timing -max_paths 20 -nworst 5', desc: '報告最差 timing paths' },
          { cmd: 'report_timing -delay_type max', desc: '報告 setup violation' },
          { cmd: 'report_timing -delay_type min', desc: '報告 hold violation' },
          { cmd: 'report_clock -skew', desc: '報告 clock skew' },
          { cmd: 'report_constraint -all_violators', desc: '報告所有 constraint violation' },
          { cmd: 'report_wns', desc: '報告 WNS (Worst Negative Slack)' },
          { cmd: 'report_tns', desc: '報告 TNS (Total Negative Slack)' },
          { cmd: 'report_power', desc: '報告功耗' },
          { cmd: 'write_sdf -output <design.sdf>', desc: '輸出 SDF timing' },
          { cmd: 'write_sdc -output <design.sdc>', desc: '輸出 updated SDC' },
          { cmd: 'write_parasitics -spef_file <design.spef>', desc: '輸出 SPEF' },
        ],
      },
      'Siemens Calibre': {
        category: 'verification',
        commands: [
          { cmd: 'calibre -drc <runset>', desc: '執行 DRC 檢查' },
          { cmd: 'calibre -lvs <runset>', desc: '執行 LVS 檢查' },
          { cmd: 'calibre -xrc <runset>', desc: '執行 xRC parasitic extraction' },
          { cmd: 'calibre -drc -hier <runset>', desc: 'Hierarchical DRC' },
          { cmd: 'calibre -genecf <runset>', desc: '產生 ECF (Extraction Control File)' },
          { cmd: 'calibre -perc <runset>', desc: 'PERC reliability 檢查' },
        ],
      },
      'Synopsys IC Validator': {
        category: 'verification',
        commands: [
          { cmd: 'icv -drc <runset>', desc: '執行 DRC 檢查' },
          { cmd: 'icv -lvs <runset>', desc: '執行 LVS 檢查' },
          { cmd: 'icv -erc <runset>', desc: '執行 ERC 檢查' },
          { cmd: 'icv -drc -layout <gds>', desc: '指定 layout 檔案 DRC' },
        ],
      },
      'Cadence Quantus': {
        category: 'extraction',
        commands: [
          { cmd: 'set_extraction_mode -signoff', desc: '設定 sign-off extraction 模式' },
          { cmd: 'extract_parasitics -spef_file <out.spef>', desc: '執行 RC extraction' },
          { cmd: 'report_qrc_tech', desc: '報告 QRC 技術檔資訊' },
          { cmd: 'set_temperature <value>', desc: '設定溫度' },
          { cmd: 'set_voltage <value>', desc: '設定電壓' },
        ],
      },
      'Cadence Voltus': {
        category: 'power',
        commands: [
          { cmd: 'set_power_analysis_mode -method dynamic_vectorless', desc: '設定動態功耗分析（vectorless）' },
          { cmd: 'set_power_analysis_mode -method static', desc: '設定靜態功耗分析' },
          { cmd: 'read_activity_file -format saif <activity.saif>', desc: '讀取 SAIF activity 檔' },
          { cmd: 'set_power_pads -self <pad>', desc: '設定 power pad' },
          { cmd: 'set_pg_library_mode -cell_type power_switch', desc: '設定 power grid library' },
          { cmd: 'report_power -by_hierarchy', desc: '報告功耗（按層級）' },
          { cmd: 'report_ir_drop -output <report>', desc: '報告 IR drop' },
          { cmd: 'report_em_analysis -output <report>', desc: '報告 EM analysis' },
        ],
      },
      'Synopsys PrimePower': {
        category: 'power',
        commands: [
          { cmd: 'read_verilog <netlist.v>', desc: '讀取閘級網表' },
          { cmd: 'read_liberty <cell.lib>', desc: '讀取 Liberty library' },
          { cmd: 'read_spef <design.spef>', desc: '讀取 SPEF' },
          { cmd: 'read_saif <activity.saif>', desc: '讀取 SAIF activity 檔' },
          { cmd: 'set_switching_activity -static_prob <0-1> -toggle_rate <Hz>', desc: '設定 switching activity' },
          { cmd: 'report_power -by_hierarchy', desc: '報告功耗（按層級）' },
          { cmd: 'report_power -by_cell', desc: '報告功耗（按 cell）' },
          { cmd: 'write_power_saif -output <out.saif>', desc: '輸出 SAIF' },
        ],
      },
    },
  },

  '8-lec': {
    name: 'Logic Equivalence Check (LEC)',
    desc: '驗證合成/ECO 前後的網表功能等價性',
    inputs: ['Golden netlist (reference)', 'Implementation netlist', 'Constraints'],
    outputs: ['LEC report (pass/fail)', 'Unmatched nets/cells'],
    tools: {
      'Cadence Conformal LEC': {
        category: 'equivalence',
        commands: [
          { cmd: 'set reference design <module>', desc: '設定 golden (reference) design' },
          { cmd: 'set implementation design <module>', desc: '設定 implementation design' },
          { cmd: 'read reference -verilog <golden.v>', desc: '讀取 golden netlist' },
          { cmd: 'read implementation -verilog <impl.v>', desc: '讀取 implementation netlist' },
          { cmd: 'set system mode setup', desc: '設定 setup 模式' },
          { cmd: 'read libraries -liberty <cell.lib>', desc: '讀取 Liberty library' },
          { cmd: 'set mapping method auto', desc: '自動設定 mapping 方法' },
          { cmd: 'set naming style', desc: '設定 naming style' },
          { cmd: 'set constant 0 <port>', desc: '設定常數 0' },
          { cmd: 'set constant 1 <port>', desc: '設定常數 1' },
          { cmd: 'set system mode lec', desc: '切換到 LEC 模式' },
          { cmd: 'add pin constraints -both <pin> <0|1>', desc: '設定 pin constraint' },
          { cmd: 'set abort on error', desc: '遇到錯誤時中止' },
          { cmd: 'run lec', desc: '執行 LEC' },
          { cmd: 'report statistics', desc: '報告統計' },
          { cmd: 'report failed -detail', desc: '報告失敗的比對' },
          { cmd: 'save', desc: '儲存 session' },
        ],
      },
      'Synopsys Formality': {
        category: 'equivalence',
        commands: [
          { cmd: 'set search_path <path>', desc: '設定搜尋路徑' },
          { cmd: 'read_verilog -r <golden.v>', desc: '讀取 golden (reference) netlist' },
          { cmd: 'read_verilog -i <impl.v>', desc: '讀取 implementation netlist' },
          { cmd: 'read_liberty -r <cell.lib>', desc: '讀取 golden Liberty' },
          { cmd: 'read_liberty -i <cell.lib>', desc: '讀取 implementation Liberty' },
          { cmd: 'set_top <module>', desc: '設定頂層模組' },
          { cmd: 'link', desc: '連結 design' },
          { cmd: 'set_constant -ref <port> 0', desc: '設定 reference 常數' },
          { cmd: 'set_constant -impl <port> 0', desc: '設定 implementation 常數' },
          { cmd: 'match', desc: '執行 matching' },
          { cmd: 'verify', desc: '執行 equivalence 驗證' },
          { cmd: 'report_failing', desc: '報告失敗的比對' },
          { cmd: 'report_statistics', desc: '報告統計' },
        ],
      },
    },
  },

  '9-eco': {
    name: 'Engineering Change Order (ECO)',
    desc: '增量修改網表：功能性 ECO（手動修改）或 timing-driven ECO（工具自動修復）',
    inputs: ['Routed design', 'ECO changes (manual or tool-generated)', 'Constraints'],
    outputs: ['ECO netlist', 'ECO report', 'Updated timing'],
    tools: {
      'Cadence Conformal ECO': {
        category: 'eco',
        commands: [
          { cmd: 'read reference -verilog <golden.v>', desc: '讀取 golden netlist' },
          { cmd: 'read implementation -verilog <impl.v>', desc: '讀取 implementation netlist' },
          { cmd: 'set system mode lec', desc: '切換到 LEC 模式確認 equivalence' },
          { cmd: 'set system mode eco', desc: '切換到 ECO 模式' },
          { cmd: 'add function eco -no_of_inputs <N> -output <port> -function <expr>', desc: '新增功能 ECO' },
          { cmd: 'remove function eco -cell <cell>', desc: '移除 cell 進行 ECO' },
          { cmd: 'modify function eco -cell <cell> -pin <pin> -net <net>', desc: '修改 cell 連接' },
          { cmd: 'report eco_status', desc: '報告 ECO 狀態' },
          { cmd: 'write -output <eco_netlist.v>', desc: '輸出 ECO 後 netlist' },
        ],
      },
      'Innovus ECO': {
        category: 'eco',
        commands: [
          { cmd: 'eco_design -noEcoRoute <eco_changes>', desc: '執行 ECO（不重新 routing）' },
          { cmd: 'eco_design -fix_drc', desc: 'ECO + 修復 DRC' },
          { cmd: 'ecoPlace', desc: 'ECO placement' },
          { cmd: 'ecoRoute -fix_drc', desc: 'ECO routing + DRC fix' },
          { cmd: 'timeDesign -postEco', desc: 'ECO 後 timing report' },
          { cmd: 'optDesign -postEco', desc: 'ECO 後 timing optimization' },
          { cmd: 'verify_drc', desc: '驗證 DRC' },
        ],
      },
    },
  },

  '10-fpga': {
    name: 'FPGA Design Flow',
    desc: 'FPGA 合成、P&R、bitstream 產生、時序分析',
    inputs: ['RTL code', 'Constraints (.xdc/.sdc)', 'FPGA-specific IP cores'],
    outputs: ['Bitstream (.bit)', 'Timing report', 'Resource utilization report'],
    tools: {
      'Xilinx Vivado': {
        category: 'fpga',
        commands: [
          { cmd: 'read_verilog <file.v>', desc: '讀取 Verilog 設計' },
          { cmd: 'read_xdc <constraints.xdc>', desc: '讀取 XDC 約束' },
          { cmd: 'synth_design -top <module> -part <fpga_part>', desc: '執行合成' },
          { cmd: 'synth_design -top <module> -part <fpga_part> -flatten_hierarchy rebuilt', desc: '合成（重建扁平化）' },
          { cmd: 'opt_design', desc: '最佳化設計' },
          { cmd: 'place_design', desc: '執行 placement' },
          { cmd: 'route_design', desc: '執行 routing' },
          { cmd: 'report_timing_summary', desc: '報告 timing 摘要' },
          { cmd: 'report_utilization', desc: '報告 resource utilization' },
          { cmd: 'report_clocks', desc: '報告時脈網路' },
          { cmd: 'report_clock_networks', desc: '報告時脈網路詳細' },
          { cmd: 'write_bitstream -file <output.bit>', desc: '產生 bitstream' },
          { cmd: 'write_debug_probes -file <probes.ltx>', desc: '產生 debug probes' },
          { cmd: 'open_hw_manager', desc: '開啟 hardware manager' },
        ],
      },
      'Intel Quartus Prime': {
        category: 'fpga',
        commands: [
          { cmd: 'read_verilog <file.v>', desc: '讀取 Verilog 設計' },
          { cmd: 'read_sdc <constraints.sdc>', desc: '讀取 SDC 約束' },
          { cmd: 'set_global_assignment -name FAMILY <family>', desc: '設定 FPGA 家族' },
          { cmd: 'set_global_assignment -name DEVICE <device>', desc: '設定目標裝置' },
          { cmd: 'set_global_assignment -name TOP_LEVEL_ENTITY <module>', desc: '設定頂層模組' },
          { cmd: 'compile_design', desc: '執行完整編譯流程' },
          { cmd: 'execute_flow -compile', desc: '執行編譯流程' },
          { cmd: 'report_timing -setup', desc: '報告 setup timing' },
          { cmd: 'report_timing -hold', desc: '報告 hold timing' },
          { cmd: 'report_resource -file <rpt.txt>', desc: '報告 resource usage' },
          { cmd: 'program_device -jtag <file.sof>', desc: '以 JTAG 燒錄裝置' },
        ],
      },
      'Synopsys Synplify': {
        category: 'fpga-synthesis',
        commands: [
          { cmd: 'set_option -top <module>', desc: '設定頂層模組' },
          { cmd: 'set_option -part <fpga_part>', desc: '設定目標 FPGA part' },
          { cmd: 'add_file -verilog <files>', desc: '加入 Verilog 原始碼' },
          { cmd: 'add_file -constraint <xdc>', desc: '加入約束檔' },
          { cmd: 'run_options -no_fatal', desc: '設定非致命錯誤選項' },
          { cmd: 'synthesize -top <module>', desc: '執行合成' },
          { cmd: 'impl_options -timing', desc: '設定實作選項（timing driven）' },
          { cmd: 'save -format edif -output <netlist.edf>', desc: '輸出 EDIF netlist' },
        ],
      },
    },
  },
};

/**
 * EDA 常用檔案格式
 */
const EDA_FORMATS = {
  '.lib': { full: 'Liberty', desc: 'Cell timing/power 模型（NLDM/CCS）', usedBy: 'Synthesis, STA, P&R' },
  '.lef': { full: 'Library Exchange Format', desc: 'Cell abstract layout（pin location, blockage, metal）', usedBy: 'P&R, DRC' },
  '.def': { full: 'Design Exchange Format', desc: '設計物理資訊（placement, routing, floorplan）', usedBy: 'P&R, Sign-off' },
  '.gds': { full: 'GDSII Stream', desc: '完整 layout 圖形格式（foundry 提交格式）', usedBy: 'Layout, DRC, LVS' },
  '.oas': { full: 'OASIS', desc: 'GDSII 替代格式（更小的檔案大小）', usedBy: 'Layout, DRC' },
  '.v': { full: 'Verilog Netlist', desc: '閘級網表（ synthesis 後）', usedBy: 'P&R, STA' },
  '.spef': { full: 'Standard Parasitic Exchange Format', desc: 'RC parasitic model', usedBy: 'STA, Post-route' },
  '.sdf': { full: 'Standard Delay Format', desc: 'Timing delay data', usedBy: 'Simulation, STA' },
  '.sdc': { full: 'Synopsys Design Constraints', desc: 'Timing constraints（clock, I/O delay）', usedBy: 'Synthesis, P&R, STA' },
  '.sby': { full: 'SymbiYosys config', desc: 'Formal verification task file', usedBy: 'Formal verification' },
  '.blif': { full: 'Berkeley Logic Interchange Format', desc: 'Logic network format', usedBy: 'Synthesis, ABC' },
  '.aig': { full: 'And-Inverter Graph', desc: 'Logic representation format', usedBy: 'ABC, Logic synthesis' },
  '.vcd': { full: 'Value Change Dump', desc: 'Waveform data', usedBy: 'Simulation, Debug' },
  '.fsdb': { full: 'Fast Signal Database', desc: 'Synopsys waveform format', usedBy: 'Verdi, Debug' },
  '.spice': { full: 'SPICE', desc: 'Circuit simulation netlist', usedBy: 'Analog simulation' },
  '.tdb': { full: 'Timing Database', desc: 'StarRC extraction database', usedBy: 'RC extraction' },
  '.sirf': { full: 'SiRF', desc: 'StarRC intermediate file', usedBy: 'RC extraction' },
};

/**
 * EDA 指令快速查詢索引
 * cmd_part → tool + full_command + desc
 */
const EDA_CMD_INDEX = {};
for (const [stageKey, stage] of Object.entries(CELL_FLOW_STAGES)) {
  for (const [tool, toolInfo] of Object.entries(stage.tools)) {
    for (const cmd of toolInfo.commands) {
      const key = cmd.cmd.toLowerCase();
      EDA_CMD_INDEX[key] = {
        stage: stage.name,
        tool,
        category: toolInfo.category,
        cmd: cmd.cmd,
        desc: cmd.desc,
      };
      // 也建立 keyword 索引
      const keywords = cmd.cmd.toLowerCase().replace(/[^a-z0-9_ ]/g, ' ').split(/\s+/);
      for (const kw of keywords) {
        if (kw.length > 3) {
          const idxKey = `_kw_${kw}`;
          if (!EDA_CMD_INDEX[idxKey]) EDA_CMD_INDEX[idxKey] = [];
          EDA_CMD_INDEX[idxKey].push({ tool, cmd: cmd.cmd, desc: cmd.desc, stage: stage.name });
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP 工具函式
// ═══════════════════════════════════════════════════════════════════════════════

async function httpsGet(url, opts = {}) {
  const controller = new AbortController();
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const headers = {
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
      ...opts.headers,
    };
    const resp = await fetch(url, { headers, signal: controller.signal });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GitHub API — PDK / Cell Library / EDA Tool 查詢
// ═══════════════════════════════════════════════════════════════════════════════

async function searchGitHubPDK(query, maxResults = 10) {
  const q = encodeURIComponent(`${query} PDK OR "standard cell" OR "process design kit"`);
  const url = `${GITHUB_API}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${maxResults}`;
  const data = await httpsGet(url);
  return (data.items || []).map(r => ({
    name: r.full_name,
    stars: r.stargazers_count,
    description: r.description || '',
    url: r.html_url,
    language: r.language,
    updated: r.updated_at,
    topics: r.topics || [],
  }));
}

async function searchGitHubEDA(query, maxResults = 10) {
  const q = encodeURIComponent(`${query} EDA OR "electronic design automation" OR synthesis OR "place and route" OR "static timing"`);
  const url = `${GITHUB_API}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${maxResults}`;
  const data = await httpsGet(url);
  return (data.items || []).map(r => ({
    name: r.full_name,
    stars: r.stargazers_count,
    description: r.description || '',
    url: r.html_url,
    language: r.language,
    updated: r.updated_at,
    topics: r.topics || [],
  }));
}

async function searchGitHubCode(query, maxResults = 5) {
  const q = encodeURIComponent(query);
  const url = `${GITHUB_API}/search/code?q=${q}&per_page=${maxResults}`;
  const data = await httpsGet(url).catch(() => ({ items: [] }));
  return (data.items || []).map(r => ({
    name: r.name,
    path: r.path,
    repo: r.repository.full_name,
    url: r.html_url,
    score: r.score,
  }));
}

function formatGitHubResults(items, title) {
  if (!items || items.length === 0) return `🔍 ${title}：無結果\n`;
  let out = `🔍 ${title}（${items.length} 筆）\n\n`;
  for (const r of items) {
    out += `### ⭐ ${r.stars} — [${r.name}](${r.url})\n`;
    out += `> ${r.description}\n`;
    if (r.language) out += `*Language: ${r.language}*`;
    if (r.topics && r.topics.length > 0) out += ` | *Topics: ${r.topics.slice(0, 5).join(', ')}*`;
    out += '\n\n';
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. OpenAlex — EDA 學術論文
// ═══════════════════════════════════════════════════════════════════════════════

async function searchOpenAlex(query, maxResults = 10) {
  const q = encodeURIComponent(query);
  const url = `${OPENALEX_API}/works?search=${q}&per_page=${maxResults}&sort=cited_by_count:desc&filter=concepts.id:C119857082|C154945302|C41008148`; // Electronics, Electrical Engineering, Computer Science
  const data = await httpsGet(url);
  return (data.results || []).map(w => ({
    title: w.title || 'Untitled',
    authors: (w.authorships || []).map(a => a.author?.display_name).filter(Boolean).slice(0, 3).join(', ') + ((w.authorships || []).length > 3 ? ' et al.' : ''),
    year: w.publication_year,
    journal: w.primary_location?.source?.display_name || '',
    doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//, '') : '',
    citedBy: w.cited_by_count || 0,
    isOA: w.open_access?.is_oa || false,
    url: w.open_access?.oa_url || w.doi || '',
    abstract: reconstructAbstract(w.abstract_inverted_index),
  }));
}

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return '';
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(' ').slice(0, 600);
}

function formatOpenAlexResults(articles) {
  if (!articles || articles.length === 0) return '📚 OpenAlex：無結果\n';
  let out = `📚 OpenAlex 學術論文（${articles.length} 筆）\n\n`;
  for (const a of articles) {
    out += `### 📄 ${a.title}\n`;
    out += `| 欄位 | 內容 |\n|------|------|\n`;
    out += `| 作者 | ${a.authors} |\n`;
    if (a.year) out += `| 年份 | ${a.year} |\n`;
    if (a.journal) out += `| 期刊/會議 | ${a.journal} |\n`;
    if (a.doi) out += `| DOI | [${a.doi}](https://doi.org/${a.doi}) |\n`;
    if (a.citedBy) out += `| 被引用 | ${a.citedBy} |\n`;
    if (a.isOA !== undefined) out += `| Open Access | ${a.isOA ? '✅' : '❌'} |\n`;
    if (a.url) out += `| 連結 | ${a.url} |\n`;
    if (a.abstract) out += `\n**摘要**: ${a.abstract}...\n`;
    out += '\n';
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Semantic Scholar — EDA 論文 + TLDR
// ═══════════════════════════════════════════════════════════════════════════════

async function searchSemanticScholar(query, maxResults = 10) {
  const q = encodeURIComponent(query);
  const fields = 'title,authors,year,venue,citationCount,externalIds,openAccessPdf,tldr,abstract';
  const url = `${SCHOLAR_API}/paper/search?query=${q}&limit=${maxResults}&fields=${fields}`;
  const data = await httpsGet(url);
  if (!data.data || data.data.length === 0) {
    return { ok: false, message: 'Semantic Scholar：無結果' };
  }
  return {
    ok: true,
    data: data.data.map(p => ({
      title: p.title || 'Untitled',
      authors: (p.authors || []).map(a => a.name).slice(0, 3).join(', ') + ((p.authors || []).length > 3 ? ' et al.' : ''),
      year: p.year,
      venue: p.venue || '',
      citedBy: p.citationCount || 0,
      doi: p.externalIds?.DOI || '',
      url: p.openAccessPdf?.url || (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : ''),
      tldr: p.tldr?.text || '',
      abstract: (p.abstract || '').slice(0, 500),
    })),
  };
}

function formatSemanticScholarResults(data) {
  if (!data || data.length === 0) return '📚 Semantic Scholar：無結果\n';
  let out = `📚 Semantic Scholar 論文（${data.length} 筆）\n\n`;
  for (const p of data) {
    out += `### 📄 ${p.title}\n`;
    out += `| 欄位 | 內容 |\n|------|------|\n`;
    out += `| 作者 | ${p.authors} |\n`;
    if (p.year) out += `| 年份 | ${p.year} |\n`;
    if (p.venue) out += `| 會議/期刊 | ${p.venue} |\n`;
    if (p.citedBy) out += `| 被引用 | ${p.citedBy} |\n`;
    if (p.doi) out += `| DOI | [${p.doi}](https://doi.org/${p.doi}) |\n`;
    if (p.url) out += `| 連結 | ${p.url} |\n`;
    if (p.tldr) out += `\n> 💡 **TLDR**: ${p.tldr}\n`;
    if (p.abstract && !p.tldr) out += `\n**摘要**: ${p.abstract}...\n`;
    out += '\n';
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PDK 快速查詢（本地索引 + GitHub API 補充）
// ═══════════════════════════════════════════════════════════════════════════════

function searchLocalPDK(query) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return [];
  const results = [];
  for (const [key, pdk] of Object.entries(PDK_INDEX)) {
    const searchable = `${key} ${pdk.name} ${pdk.node} ${pdk.foundry} ${(pdk.cells || []).join(' ')}`.toLowerCase();
    // OR logic: any word matches = hit
    if (words.some(w => searchable.includes(w))) {
      results.push({ key, ...pdk });
    }
  }
  return results;
}

function formatPDKResults(results) {
  if (!results || results.length === 0) return '🏭 PDK：無符合結果\n';
  let out = `🏭 PDK / Cell Library 查詢結果（${results.length} 筆）\n\n`;
  for (const p of results) {
    out += `### 🔬 ${p.name} (${p.node})\n`;
    out += `| 欄位 | 內容 |\n|------|------|\n`;
    out += `| Foundry | ${p.foundry} |\n`;
    out += `| 類型 | ${p.type} |\n`;
    out += `| GitHub | [${p.repo}](https://github.com/${p.repo}) |\n`;
    if (p.pythonPkg) out += `| Python Package | \`pip install ${p.pythonPkg}\` |\n`;
    if (p.cells && p.cells.length > 0) out += `| Cell Libraries | ${p.cells.join(', ')} |\n`;
    out += `| 說明 | ${p.desc} |\n\n`;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. EDA Tool 快速查詢（本地索引）
// ═══════════════════════════════════════════════════════════════════════════════

function searchLocalTools(query) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return [];
  const results = [];
  for (const [key, tool] of Object.entries(EDA_TOOL_INDEX)) {
    const searchable = `${key} ${tool.name} ${tool.category} ${tool.desc} ${tool.alt}`.toLowerCase();
    // OR logic: any word matches = hit
    if (words.some(w => searchable.includes(w))) {
      results.push({ key, ...tool });
    }
  }
  return results;
}

function formatToolResults(results) {
  if (!results || results.length === 0) return '🔧 EDA Tool：無符合結果\n';
  let out = `🔧 EDA 工具查詢結果（${results.length} 筆）\n\n`;
  for (const t of results) {
    out += `### ⚙️ ${t.name}\n`;
    out += `| 欄位 | 內容 |\n|------|------|\n`;
    out += `| 分類 | ${t.category} |\n`;
    out += `| GitHub | [${t.repo}](https://github.com/${t.repo}) |\n`;
    out += `| 文件 | ${t.docs} |\n`;
    out += `| 說明 | ${t.desc} |\n`;
    if (t.alt) out += `| 商業替代 | ${t.alt} |\n`;
    out += '\n';
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. EDA 論文特殊查詢（會議/主題）
// ═══════════════════════════════════════════════════════════════════════════════

function detectConference(query) {
  const q = query.toUpperCase();
  for (const conf of EDA_CONFERENCES) {
    if (q.includes(conf.toUpperCase())) return conf;
  }
  return null;
}

function enhanceQueryForEDA(query) {
  // 如果查詢已包含 EDA 關鍵詞，直接用
  const edaKeywords = ['synthesis', 'placement', 'routing', 'timing', 'clock tree', 'floorplan',
    'P&R', 'STA', 'DRC', 'LVS', 'PDK', 'standard cell', 'RTL', 'GDSII', 'netlist',
    'EDA', 'VLSI', 'ASIC', 'FPGA', 'FinFET', 'CMOS'];
  const hasEDAKeyword = edaKeywords.some(k => query.toLowerCase().includes(k.toLowerCase()));
  if (hasEDAKeyword) return query;
  // 否則加上 EDA 背景
  return `${query} VLSI EDA IC design`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 主要處理函式
// ═══════════════════════════════════════════════════════════════════════════════

async function edaSearch(args = {}) {
  const action = String(args.action || 'auto').toLowerCase();
  const question = String(args.question || '').trim();
  const query = String(args.query || '').trim();
  const searchQuery = question || query;
  const maxResults = args.maxResults || 10;

  if (!searchQuery && !['list-tools', 'list-pdk', 'list-conferences', 'flow', 'dft', 'lec', 'eco', 'fpga'].includes(action)) {
    return { ok: false, error: '需要提供 question 或 query 參數' };
  }

  try {
    switch (action) {

      // ── 自動模式：智能判斷查詢類型 ──
      case 'auto': {
        const q = searchQuery.toLowerCase();

        // PDK 相關查詢
        if (q.includes('pdk') || q.includes('sky') || q.includes('asap') || q.includes('cell lib')
          || q.includes('130nm') || q.includes('7nm') || q.includes('45nm') || q.includes('180nm')
          || q.includes('finfet') || q.includes('gf180') || q.includes('nangate')) {
          const localPDK = searchLocalPDK(searchQuery);
          let output = '';
          if (localPDK.length > 0) {
            output += formatPDKResults(localPDK) + '\n';
          }
          // 補充 GitHub 搜尋
          try {
            const ghResults = await searchGitHubPDK(searchQuery, 5);
            output += formatGitHubResults(ghResults, 'GitHub 相關 PDK 專案');
          } catch { /* ignore */ }
          return { ok: true, output: output || '🔍 自動搜尋：未找到 PDK 相關結果' };
        }

        // EDA 工具查詢
        if (q.includes('tool') || q.includes('工具') || q.includes('synthesis') || q.includes('synth')
          || q.includes(' STA') || q.includes('timing') || q.includes('place') || q.includes('route')
          || q.includes('verilat') || q.includes('iverilog') || q.includes('yosys') || q.includes('openroad')
          || q.includes('klayout') || q.includes('simulation') || q.includes('formal')
          || q.includes('dc ') || q.includes('genus') || q.includes('innovus') || q.includes('icc2')
          || q.includes('primetime') || q.includes('tempus') || q.includes('lec') || q.includes('formality')
          || q.includes('eco') || q.includes('vivado') || q.includes('quartus') || q.includes('calibre')
          || q.includes('icv') || q.includes('vcs') || q.includes('xcelium') || q.includes('questa')
          || q.includes('jasper') || q.includes('spyglass') || q.includes('dft') || q.includes('modus')
          || q.includes('virtuoso') || q.includes('starrc') || q.includes('quantus') || q.includes('voltus')
          || q.includes('primepower') || q.includes('redhawk') || q.includes('totem') || q.includes('hal')
          || q.includes('diamond') || q.includes('synplify') || q.includes('netgen')) {
          const localTools = searchLocalTools(searchQuery);
          let output = '';
          if (localTools.length > 0) {
            output += formatToolResults(localTools) + '\n';
          }
          try {
            const ghResults = await searchGitHubEDA(searchQuery, 5);
            output += formatGitHubResults(ghResults, 'GitHub 相關 EDA 工具');
          } catch { /* ignore */ }
          return { ok: true, output: output || '🔍 自動搜尋：未找到 EDA 工具相關結果' };
        }

        // 學術論文（預設 fallback）
        let output = '';
        const enhancedQuery = enhanceQueryForEDA(searchQuery);
        try {
          const scholarResult = await searchSemanticScholar(enhancedQuery, maxResults);
          if (scholarResult.ok) {
            output += formatSemanticScholarResults(scholarResult.data) + '\n';
          }
        } catch { /* ignore */ }
        try {
          const articles = await searchOpenAlex(enhancedQuery, Math.min(maxResults, 5));
          output += formatOpenAlexResults(articles);
        } catch { /* ignore */ }
        return { ok: true, output: output || '🔍 自動搜尋：未找到相關論文' };
      }

      // ── PDK / Cell Library 查詢 ──
      case 'pdk': {
        const localPDK = searchLocalPDK(searchQuery);
        let output = formatPDKResults(localPDK);
        // 補充 GitHub
        try {
          const ghResults = await searchGitHubPDK(searchQuery, maxResults);
          output += '\n' + formatGitHubResults(ghResults, 'GitHub PDK 相關專案');
        } catch { /* ignore */ }
        return { ok: true, output };
      }

      // ── EDA 學術論文搜尋 ──
      case 'paper':
      case 'papers': {
        let output = '';
        const enhancedQuery = enhanceQueryForEDA(searchQuery);

        // Semantic Scholar + TLDR
        try {
          const scholarResult = await searchSemanticScholar(enhancedQuery, maxResults);
          if (scholarResult.ok) {
            output += formatSemanticScholarResults(scholarResult.data) + '\n';
          } else {
            output += `⚠️ ${scholarResult.message}\n\n`;
          }
        } catch (err) {
          output += `⚠️ Semantic Scholar：${err.message}\n\n`;
        }

        // OpenAlex
        try {
          const articles = await searchOpenAlex(enhancedQuery, Math.min(maxResults, 5));
          output += formatOpenAlexResults(articles);
        } catch (err) {
          output += `⚠️ OpenAlex：${err.message}\n`;
        }

        // 偵測是否提到特定會議
        const conf = detectConference(searchQuery);
        if (conf) {
          output += `\n💡 偵測到會議 **${conf}**，建議搜尋：\n`;
          output += `  • [ACM Digital Library](https://dl.acm.org/doi/proceedings/${conf})\n`;
          output += `  • [IEEE Xplore](https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${conf}%20EDA)\n`;
          output += `  • [dblp](https://dblp.org/search?q=${conf})\n`;
        }

        return { ok: true, output: output || '📚 學術論文：無結果' };
      }

      // ── EDA 工具文件搜尋 ──
      case 'tool':
      case 'tools': {
        const localTools = searchLocalTools(searchQuery);
        let output = formatToolResults(localTools);

        // GitHub 搜尋更多工具
        try {
          const ghResults = await searchGitHubEDA(searchQuery, maxResults);
          output += '\n' + formatGitHubResults(ghResults, 'GitHub EDA 工具');
        } catch { /* ignore */ }

        return { ok: true, output };
      }

      // ── GitHub EDA 專案搜尋 ──
      case 'github': {
        const results = await searchGitHubEDA(searchQuery, maxResults);
        return { ok: true, output: formatGitHubResults(results, 'GitHub EDA 專案') };
      }

      // ── GitHub 程式碼搜尋 ──
      case 'code': {
        const results = await searchGitHubCode(searchQuery, Math.min(maxResults, 5));
        if (!results || results.length === 0) {
          return { ok: true, output: '🔍 GitHub 程式碼：無結果\n' };
        }
        let out = `🔍 GitHub 程式碼搜尋（${results.length} 筆）\n\n`;
        for (const r of results) {
          out += `### 📄 [${r.name}](${r.url})\n`;
          out += `*Repo: ${r.repo} | Path: ${r.path}*\n\n`;
        }
        return { ok: true, output: out };
      }

      // ── PDK + Tool + Paper 綜合搜尋 ──
      case 'all':
      case 'comprehensive': {
        let output = '';

        // PDK
        const localPDK = searchLocalPDK(searchQuery);
        if (localPDK.length > 0) output += formatPDKResults(localPDK);

        // Tools
        const localTools = searchLocalTools(searchQuery);
        if (localTools.length > 0) output += formatToolResults(localTools);

        // Papers
        const enhancedQuery = enhanceQueryForEDA(searchQuery);
        try {
          const scholarResult = await searchSemanticScholar(enhancedQuery, 5);
          if (scholarResult.ok) output += formatSemanticScholarResults(scholarResult.data);
        } catch { /* ignore */ }

        // GitHub
        try {
          const ghResults = await searchGitHubEDA(searchQuery, 5);
          output += formatGitHubResults(ghResults, 'GitHub 相關專案');
        } catch { /* ignore */ }

        return { ok: true, output: output || '🔍 綜合搜尋：未找到結果' };
      }

      // ── 列出已知 EDA 工具 ──
      case 'list-tools': {
        let out = `🔧 已索引 EDA 工具（${Object.keys(EDA_TOOL_INDEX).length} 筆）\n\n`;
        out += `| 類別 | 工具 | 商業替代 |\n|------|------|----------|\n`;
        for (const [key, t] of Object.entries(EDA_TOOL_INDEX)) {
          out += `| ${t.category} | **${t.name}** (\`${key}\`) | ${t.alt} |\n`;
        }
        return { ok: true, output: out };
      }

      // ── 列出已知 PDK ──
      case 'list-pdk': {
        let out = `🏭 已索引 PDK（${Object.keys(PDK_INDEX).length} 筆）\n\n`;
        out += `| 名稱 | 節點 | 類型 | Foundry |\n|------|------|------|----------|\n`;
        for (const [key, p] of Object.entries(PDK_INDEX)) {
          out += `| **${p.name}** (\`${key}\`) | ${p.node} | ${p.type} | ${p.foundry} |\n`;
        }
        return { ok: true, output: out };
      }

      // ── 列出 EDA 關鍵會議 ──
      case 'list-conferences': {
        let out = `🎓 EDA 關鍵會議\n\n`;
        const confDetails = {
          'DAC': { full: 'Design Automation Conference', url: 'https://www.dac.com/', freq: '每年 6 月' },
          'ICCAD': { full: 'International Conference on Computer-Aided Design', url: 'https://www.iccad.com/', freq: '每年 11 月' },
          'ISPD': { full: 'International Symposium on Physical Design', url: 'https://www.ispd.cc/', freq: '每年 4 月' },
          'DATE': { full: 'Design, Automation & Test in Europe', url: 'https://www.date-conference.com/', freq: '每年 3 月' },
          'ASP-DAC': { full: 'Asia and South Pacific Design Automation Conference', url: 'https://www.aspdac.com/', freq: '每年 1 月' },
          'VLSI Symposium': { full: 'IEEE Symposium on VLSI Technology and Circuits', url: 'https://www.vlsisymposium.org/', freq: '每年 6 月' },
          'ISSCC': { full: 'International Solid-State Circuits Conference', url: 'https://www.isscc.org/', freq: '每年 2 月' },
          'IEDM': { full: 'International Electron Devices Meeting', url: 'https://www.iedm.org/', freq: '每年 12 月' },
          'TCAD': { full: 'IEEE Trans. on Computer-Aided Design', url: 'https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=43', freq: '月刊' },
        };
        for (const [abbr, detail] of Object.entries(confDetails)) {
          out += `### ${abbr}\n`;
          out += `* **全名**: ${detail.full}\n`;
          out += `* **頻率**: ${detail.freq}\n`;
          out += `* **官網**: ${detail.url}\n\n`;
        }
        return { ok: true, output: out };
      }

      // ── Cell Flow stages 查詢 ──
      case 'flow': {
        const q = (searchQuery || '').toLowerCase();
        let matchedStage = null;
        for (const [key, stage] of Object.entries(CELL_FLOW_STAGES)) {
          const searchStr = `${key} ${stage.name} ${stage.desc}`.toLowerCase();
          if (q && (q.includes(key) || q.includes(stage.name.toLowerCase()) || searchStr.includes(q))) {
            matchedStage = { key, ...stage };
            break;
          }
        }
        if (matchedStage) {
          let out = `🔄 **${matchedStage.name}** (${matchedStage.key})\n\n`;
          out += `${matchedStage.desc}\n\n`;
          out += `**Inputs**: ${matchedStage.inputs.join(', ')}\n`;
          out += `**Outputs**: ${matchedStage.outputs.join(', ')}\n\n`;
          out += `**可用工具**:\n\n`;
          for (const [toolName, toolData] of Object.entries(matchedStage.tools)) {
            out += `### ${toolName}\n`;
            for (const c of toolData.commands) {
              out += `- \`${c.cmd}\` — ${c.desc}\n`;
            }
            out += '\n';
          }
          return { ok: true, output: out };
        }
        // 沒有指定 query → 列出所有 stages
        let out = `🔄 **Cell-based 設計流程** (\${Object.keys(CELL_FLOW_STAGES).length} 個階段)\n\n`;
        out += `| Stage | 名稱 | 說明 |\n|-------|------|------|\n`;
        for (const [key, stage] of Object.entries(CELL_FLOW_STAGES)) {
          out += `| \`${key}\` | **${stage.name}** | ${stage.desc.slice(0, 50)}... |\n`;
        }
        out += `\n💡 用法: \`action=flow query=\"2-synthesis\"\` 查看特定階段的工具命令\n`;
        return { ok: true, output: out };
      }

      // ── DFT 流程查詢 ──
      case 'dft': {
        const stage = CELL_FLOW_STAGES['1.5-dft'];
        if (!stage) return { ok: false, error: 'DFT stage not found' };
        let out = `🔧 **${stage.name}**\n\n`;
        out += `${stage.desc}\n\n`;
        for (const [toolName, toolData] of Object.entries(stage.tools)) {
          out += `### ${toolName}\n`;
          for (const c of toolData.commands) {
            out += `- \`${c.cmd}\` — ${c.desc}\n`;
          }
          out += '\n';
        }
        return { ok: true, output: out };
      }

      // ── LEC 流程查詢 ──
      case 'lec': {
        const stage = CELL_FLOW_STAGES['8-lec'];
        if (!stage) return { ok: false, error: 'LEC stage not found' };
        let out = `⚖️ **${stage.name}**\n\n`;
        out += `${stage.desc}\n\n`;
        for (const [toolName, toolData] of Object.entries(stage.tools)) {
          out += `### ${toolName}\n`;
          for (const c of toolData.commands) {
            out += `- \`${c.cmd}\` — ${c.desc}\n`;
          }
          out += '\n';
        }
        return { ok: true, output: out };
      }

      // ── ECO 流程查詢 ──
      case 'eco': {
        const stage = CELL_FLOW_STAGES['9-eco'];
        if (!stage) return { ok: false, error: 'ECO stage not found' };
        let out = `🔧 **${stage.name}**\n\n`;
        out += `${stage.desc}\n\n`;
        for (const [toolName, toolData] of Object.entries(stage.tools)) {
          out += `### ${toolName}\n`;
          for (const c of toolData.commands) {
            out += `- \`${c.cmd}\` — ${c.desc}\n`;
          }
          out += '\n';
        }
        return { ok: true, output: out };
      }

      // ── FPGA 流程查詢 ──
      case 'fpga': {
        const stage = CELL_FLOW_STAGES['10-fpga'];
        if (!stage) return { ok: false, error: 'FPGA stage not found' };
        let out = `🧩 **${stage.name}**\n\n`;
        out += `${stage.desc}\n\n`;
        for (const [toolName, toolData] of Object.entries(stage.tools)) {
          out += `### ${toolName}\n`;
          for (const c of toolData.commands) {
            out += `- \`${c.cmd}\` — ${c.desc}\n`;
          }
          out += '\n';
        }
        return { ok: true, output: out };
      }

      default:
        return { ok: false, error: `未知 action: ${action}. 可用: auto, pdk, paper, tool, github, code, all, list-tools, list-pdk, list-conferences, flow, dft, lec, eco, fpga` };
    }
  } catch (err) {
    return { ok: false, error: `EDA 搜尋錯誤: ${err.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plugin Export
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  name: 'smart_eda_search',
  description:
    '[search] EDA 領域智慧知識引擎。查詢 IC design、cell-based flow、EDA tool、PDK、學術論文。'
    + '完全免費，不需要 API 金鑰。'
    + '支援 11 種 action：auto（自動判斷）、pdk（PDK/cell library）、paper（學術論文）、tool（EDA 工具）、github（GitHub 專案）、code（程式碼搜尋）、all（綜合）、list-tools、list-pdk、list-conferences。'
    + '資料來源：GitHub API + OpenAlex + Semantic Scholar。'
    + '內建 48+ EDA 工具索引（含 30+ 商業工具）、10+ PDK 索引、11 個 cell flow stages、9 大 EDA 會議。',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'auto', 'pdk', 'paper', 'papers',
          'tool', 'tools', 'github', 'code',
          'all', 'comprehensive',
          'list-tools', 'list-pdk', 'list-conferences',
          'flow', 'dft', 'lec', 'eco', 'fpga',
        ],
        description: '查詢動作。auto=自動判斷類型，pdk=PDK/cell library，paper=學術論文，tool=EDA工具，github=GitHub專案，code=程式碼搜尋，all=綜合，list-tools=列出已知工具，list-pdk=列出已知PDK，list-conferences=列出EDA會議，flow=cell flow stages，dft=Design-for-Test，lec=Logic Equivalence Check，eco=Engineering Change Order，fpga=FPGA Design Flow',
      },
      question: {
        type: 'string',
        description: 'EDA 相關問題或查詢（例如："SKY130 standard cell library 有哪些？"）',
      },
      query: {
        type: 'string',
        description: '查詢字串（question 的別名，兩者擇一提供）',
      },
      maxResults: {
        type: 'number',
        description: '最大結果數量（預設 10）',
      },
    },
  },
  handler: edaSearch,
};
