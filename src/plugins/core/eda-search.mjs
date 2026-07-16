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

// ── 常見 Tool Issue FAQ 索引 ─────────────────────────────────────────────────
// 常見錯誤模式 + 解決方案 + 廠商 Q&A 搜尋 URL
const TOOL_FAQ_INDEX = {
  'dc': {
    tool: 'Synopsys Design Compiler',
    vendor: 'synopsys',
    faqs: [
      {
        pattern: /can't resolve reference|unresolved reference/i,
        error: "Error: can't resolve reference to...",
        cause: 'link 階段找不到 cell/module 定義，通常是 library 路徑或 module 名稱錯誤',
        solution: '1) 檢查 set_app_var target_library 路徑\n2) 確認 link_library 包含所有使用的 cell\n3) 執行 check_design 確認 design integrity',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=unresolved+reference+DC',
      },
      {
        pattern: /no such design|design .* not found/i,
        error: 'Error: No such design or design not found',
        cause: 'analyze 後的 elaborate 名稱不正確，或 analyze 時有語法錯誤',
        solution: '1) 確認 analyze 的 file 中 module 名稱\n2) 檢查 analyze 輸出是否有 error/warning\n3) 用 check_design 確認',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=no+such+design+DC',
      },
      {
        pattern: /timing violation|setup violation|hold violation/i,
        error: 'Timing violation: setup/hold slack < 0',
        cause: '合成後時序無法收斂',
        solution: '1) report_timing -max_paths 10 找最差路徑\n2) compile_ultra -timing_high_effort_script\n3) 加 set_max_transition / set_max_capacitance\n4) 考慮 clock gating 或 pipeline',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=timing+violation+synthesis',
      },
      {
        pattern: /area .* exceeded|design area .* too large/i,
        error: 'Design area exceeds constraint',
        cause: '面積超過 set_max_area 設定',
        solution: '1) report_area -hierarchy 找面積大户\n2) set_max_area 0 讓工具全力優化\n3) 檢查是否有未最佳化的邏輯\n4) 考慮邏輯共享或 resource sharing',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=area+exceeded+DC',
      },
      {
        pattern: /cannot find module|module .* not defined/i,
        error: "Error: Cannot find module...",
        cause: '缺少 module 定義或未加入 analyze 清單',
        solution: '1) 確認所有 RTL 檔案都在 analyze 清單中\n2) 檢查 search_path 設定\n3) 用 read_file -verilog <file> 補充',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=cannot+find+module+DC',
      },
    ],
  },
  'innovus': {
    tool: 'Cadence Innovus',
    vendor: 'cadence',
    faqs: [
      {
        pattern: /cannot find|can't find|file not found/i,
        error: 'Error: Cannot find file / cannot find library',
        cause: 'LEF/Liberty/Verilog 路徑設定錯誤',
        solution: '1) 檢查 set init_verilog / set init_lef_file 路徑\n2) 確認 init_design 前所有檔案路徑正確\n3) 用 file_exists 確認檔案存在',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
      {
        pattern: /design has unroutable|congestion|too much congestion/i,
        error: 'Design has unroutable nets / high congestion',
        cause: 'placement 後 routing congestion 過高',
        solution: '1) reportCongestion -hotSpot 找 hotspot\n2) setPlaceMode -congEffort high\n3) 降低 utilization 或調整 pin 位置\n4) setNanoRouteMode -routeWithTimingDriven true',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
      {
        pattern: /timing .* not met|setup .* violation|hold .* violation/i,
        error: 'Timing not met after route',
        cause: 'Post-route timing violation',
        solution: '1) timeDesign -postRoute 檢查 violation\n2) optDesign -postRoute 優化\n3) 檢查 clock tree skew\n4) setAnalysisMode -analysisType onChipVariation',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
      {
        pattern: /DRC violation|design rule violation/i,
        error: 'DRC violations detected',
        cause: 'Routing 或 placement 造成 DRC 違規',
        solution: '1) verify_drc 檢查詳細 violation\n2) ecoRoute -fix_drc 修復\n3) 檢查 LEF 設定是否正確\n4) 確認 technology LEF 包含所有 routing layer',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
      {
        pattern: /mmmc.*not found|constraint.*error/i,
        error: 'MMMC / constraint file error',
        cause: 'MMMC 檔案路徑或內容錯誤',
        solution: '1) 確認 set init_mmmc_file 路徑正確\n2) 檢查 MMMC 中的 scenario 定義\n3) 確認 liberty/SDC 路徑在 MMMC 中正確',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
    ],
  },
  'primetime': {
    tool: 'Synopsys PrimeTime',
    vendor: 'synopsys',
    faqs: [
      {
        pattern: /cannot read|no such file|file not found/i,
        error: 'Error: Cannot read file...',
        cause: ' Liberty/Verilog/SPEF/SDC 檔案路徑錯誤',
        solution: '1) 確認 read_liberty/read_verilog/read_spef 路徑\n2) 檢查 current_design 是否正確設定\n3) 用 which 確認檔案存在',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=cannot+read+PrimeTime',
      },
      {
        pattern: /no clocks|clock .* not found/i,
        error: 'Warning: No clocks found',
        cause: 'SDC 中未定義 clock，或 get_clocks 名稱不匹配',
        solution: '1) 確認 create_clock 定義正確\n2) 檢查 clock port 名稱\n3) report_clock 確認時脈網路',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=no+clocks+PrimeTime',
      },
      {
        pattern: /unconstrained|unconstrained pin/i,
        error: 'Warning: Pin is unconstrained',
        cause: '某些 pin 沒有 timing constraint',
        solution: '1) report_constraint -all_violators 找 unconstrained pins\n2) 補 set_input_delay / set_output_delay\n3) 設定 set_false_path 或 set_multicycle_path',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=unconstrained+PrimeTime',
      },
      {
        pattern: /SPEF.*mismatch|parasitic.*mismatch/i,
        error: 'Warning: SPEF/net name mismatch',
        cause: 'SPEF 中的 net 名稱與 design 不匹配',
        solution: '1) 確認 SPEF 是從同一個 design 產生\n2) 檢查 net name mapping\n3) 重新 extract RC（用 StarRC/Quantus）',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=SPEF+mismatch+PrimeTime',
      },
      {
        pattern: /timing.*not met|setup.*violation|hold.*violation|slack/i,
        error: 'Timing violation: setup/hold slack < 0',
        cause: 'Post-route 或 sign-off timing violation',
        solution: '1) report_timing -max_paths 10 找最差路徑\n2) report_constraint -all_violators 找所有 violation\n3) 檢查 clock uncertainty 和 OCV 設定\n4) 考慮 multi-corner/multi-mode 分析',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=timing+violation+PrimeTime',
      },
    ],
  },
  'calibre': {
    tool: 'Siemens Calibre',
    vendor: 'siemens',
    faqs: [
      {
        pattern: /DRC error|design rule check/i,
        error: 'Calibre DRC errors detected',
        cause: 'Layout 違反 design rule',
        solution: '1) 檢查 RVE 中的 error 詳細位置\n2) 確認 DRC runset 與 PDK 版本匹配\n3) 常見：spacing/width/enclosure violation\n4) 用 KLayout 或 Magic 做初步 DRC',
        solvnet: 'https://eda.com/support/calibre',
      },
      {
        pattern: /LVS.*mismatch|schematic.*mismatch/i,
        error: 'Calibre LVS: Net/Device mismatch',
        cause: 'Layout 與 schematic 不一致',
        solution: '1) 檢查 LVS report 中的 mismatch 詳情\n2) 確認 net name matching 設定\n3) 常見：missing net, wrong device count\n4) 用 XRC extraction 確認連接性',
        solvnet: 'https://eda.com/support/calibre',
      },
      {
        pattern: /antenna|antenna rule/i,
        error: 'Calibre: Antenna rule violation',
        cause: 'Metal layer 面積過大造成加工時 charge 損壞',
        solution: '1) 加 antenna diode 或 jumper\n2) 在 Innovus 中 setNanoRouteMode -routeWithAntenna true\n3) 檢查 LEF 中的 antenna 規則定義',
        solvnet: 'https://eda.com/support/calibre',
      },
    ],
  },
  'vivado': {
    tool: 'Xilinx Vivado',
    vendor: 'xilinx',
    faqs: [
      {
        pattern: /timing.*not met|setup.*violation|hold.*violation/i,
        error: 'Timing constraint not met',
        cause: 'FPGA 設計時序無法收斂',
        solution: '1) report_timing_summary 找 violation\n2) 調整 clock constraint（set_clock_groups / set_false_path）\n3) 考慮 pipelining 或 restructure\n4) 檢查 clock domain crossing',
        solvnet: 'https://support.xilinx.com/s/article/65498',
      },
      {
        pattern: /utilization.*exceeded|too many/i,
        error: 'Device utilization exceeded',
        cause: 'FPGA 資源不足',
        solution: '1) report_utilization 檢查各資源使用量\n2) 考慮更大型號 FPGA\n3) 優化 RTL 減少 LUT/FF 使用\n4) 用 synthesis 的 -flatten_hierarchy 優化',
        solvnet: 'https://support.xilinx.com/s/article/65498',
      },
      {
        pattern: /bitstream.*error|implementation.*failed/i,
        error: 'Bitstream generation failed',
        cause: 'Implementation 階段失敗',
        solution: '1) 檢查 implementation log 中的 error\n2) 確認 constraint 語法正確\n3) 跑 opt_design -retarget -propagate -sweep\n4) 用 report_drc 檢查 design rule',
        solvnet: 'https://support.xilinx.com/s/article/65498',
      },
      {
        pattern: /warning.*critical|critical.*warning|warning/i,
        error: 'Critical warnings during synthesis/implementation',
        cause: 'Constraint 警告或 design 問題',
        solution: '1) report_property -file 檢查所有 warning\n2) 常見：未連接 port、multiple driver、latch inference\n3) 用 set_property -dict 修復 constraint\n4) 檢查 XDC 語法是否正確',
        solvnet: 'https://support.xilinx.com/s/article/65498',
      },
    ],
  },
  'quartus': {
    tool: 'Intel Quartus Prime',
    vendor: 'intel',
    faqs: [
      {
        pattern: /timing.*violation|setup.*error|fmax/i,
        error: 'Timing violations / Fmax not met',
        cause: '時序無法收斂到目標頻率',
        solution: '1) TimeQuest 檢查 critical path\n2) 加 set_false_path / set_multicycle_path\n3) 調 synthesis 設定（-effort_high）\n4) 考慮 pipeline 寄存器',
        solvnet: 'https://www.intel.com/content/www/us/en/support/programmable/support.html',
      },
      {
        pattern: /resource.*exceeded|too many logic elements/i,
        error: 'Logic elements / resources exceeded',
        cause: 'FPGA 資源不足',
        solution: '1) Compilation Report 檢查 resource usage\n2) 考慮更大型號\n3) 優化 RTL 減少邏輯使用\n4) 用 Hyperflex 或 F- registros 優化',
        solvnet: 'https://www.intel.com/content/www/us/en/support/programmable/support.html',
      },
    ],
  },
  'vcs': {
    tool: 'Synopsys VCS',
    vendor: 'synopsys',
    faqs: [
      {
        pattern: /syntax error|parse error/i,
        error: 'Syntax/parse error during compilation',
        cause: 'SystemVerilog 語法不相容或缺少 library',
        solution: '1) 加 -sverilog 啟用 SV 支援\n2) 檢查 file list 是否完整\n3) 用 -lint_only 做預檢\n4) 確認 VCS 版本支援你的 SV feature',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=syntax+error+VCS',
      },
      {
        pattern: /module already defined|duplicate module/i,
        error: 'Module already defined',
        cause: '同一個 module 被 include 多次',
        solution: '1) 檢查 file list 是否有重複\n2) 用 `ifndef guard 保護 header\n3) -sverilog +incdir+ 檢查 include 路徑',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=module+already+defined+VCS',
      },
      {
        pattern: /crash|core dump|segfault|internal error/i,
        error: 'VCS crash / core dump',
        cause: 'VCS compiler/runtime 內部錯誤',
        solution: '1) 確認 VCS 版本與 design 複雜度匹配\n2) 加 -debug_access+all 重現問題\n3) 檢查系統記憶體是否足夠\n4) 嘗試 -kdb 生成 debug 資料',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=crash+VCS',
      },
    ],
  },
  'xcelium': {
    tool: 'Cadence Xcelium',
    vendor: 'cadence',
    faqs: [
      {
        pattern: /syntax error|parse error/i,
        error: 'Syntax error during compilation',
        cause: '語法不相容或缺少 library mapping',
        solution: '1) 確認 -sv 啟用 SystemVerilog\n2) 檢查 cdslck 文件\n3) 用 -liccheck 確認 license\n4) xmvlog -help 確認支援的 feature',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
    ],
  },
  'lec': {
    tool: 'Cadence Conformal LEC',
    vendor: 'cadence',
    faqs: [
      {
        pattern: /LEC.*fail|equivalence.*fail|not equivalent/i,
        error: 'LEC verification failed', cause: 'Golden 與 implementation 網表功能不等價',
        solution: '1) report failed -detail 找非等價點\n2) 確認 constant pin 設定正確\n3) 檢查 naming style 是否一致\n4) 用手動 mapping 修復',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
    ],
  },
  'formality': {
    tool: 'Synopsys Formality',
    vendor: 'synopsys',
    faqs: [
      {
        pattern: /match.*fail|verify.*fail|not equivalent/i,
        error: 'Formality verification failed',
        cause: 'Reference 與 implementation 不等價',
        solution: '1) report_failing 找失敗的 pin\n2) 確認 set_top 名稱正確\n3) 檢查 constant 設定\n4) 用 match -successful 找成功比對',
        solvnet: 'https://solvnet.synopsys.com/solve/qa?search=formality+verification+fail',
      },
    ],
  },
  'genus': {
    tool: 'Cadence Genus Synthesis',
    vendor: 'cadence',
    faqs: [
      {
        pattern: /can't elaborate|elaborate.*fail|elaborate.*error/i,
        error: "Error: Can't elaborate design",
        cause: 'RTL module 定義找不到或名稱不對',
        solution: '1) 確認 read_file 包含所有 RTL 檔案\n2) 檢查 module 名稱是否與 elaborate 一致\n3) 用 elaborate -list 確認 available modules\n4) 檢查 search_path 設定',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
      {
        pattern: /synthesize.*fail|synthesis.*error|generic.*fail/i,
        error: 'Synthesis failed / generic error',
        cause: 'RTL 語法不支援或 design 結構問題',
        solution: '1) 檢查 elaboration 輸出是否有 warning/error\n2) 確認 RTL 用 synthesizable subset\n3) 用 read_file -sv 確認 SV 支援\n4) 設定 syn_generic_effort high',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
      {
        pattern: /timing.*violation|setup.*fail|hold.*fail/i,
        error: 'Timing violation after synthesis',
        cause: '合成後時序無法收斂',
        solution: '1) report_timing 找最差路徑\n2) set_db syn_map_effort high\n3) 設定 set_max_transition / set_max_capacitance\n4) 考慮 clock gating 或 pipeline',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
      {
        pattern: /area.*exceeded|design.*too large/i,
        error: 'Design area exceeds constraint',
        cause: '面積超過限制',
        solution: '1) report_area -hierarchy 找面積大戶\n2) set_max_area 0 放寬限制\n3) 檢查 resource sharing\n4) 考慮邏輯共享',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
      {
        pattern: /conformal.*fail|equivalent.*fail|lec.*fail/i,
        error: 'Conformal equivalence check failed',
        cause: 'RTL 與 gate-level netlist 不等價',
        solution: '1) 確認 write_design 沒有改變功能\n2) 檢查 constant pin 設定\n3) 用 set_constant 修復 scan signal\n4) 用 Conformal LEC 做獨立驗證',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
      {
        pattern: /cannot find|file not found|no such file/i,
        error: "Error: Cannot find file / module",
        cause: 'RTL/Liberty/LEF 檔案路徑錯誤',
        solution: '1) 確認 read_file 路徑正確\n2) 檢查 search_path 設定\n3) 用 which 確認檔案存在\n4) 確認 filelist 格式正確',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
      {
        pattern: /unexpected|weird|incorrect|wrong result/i,
        error: 'Unexpected behavior / incorrect results',
        cause: 'Genus 工具 bug 或 constraint 設定錯誤',
        solution: '1) 檢查 synthesis log 中的 warning\n2) 確認 SDC constraint 語法正確\n3) 用 set_db 確認工具版本\n4) 到 Cadence Support 提交 SR',
        solvnet: 'https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution',
      },
    ],
  },
};

// ── 廠商文件 URL 索引 ─────────────────────────────────────────────────────────
// 開源工具：GitHub raw URL（可直接爬取）
// 商業工具：常見 topic 的文件段落 + SolvNet 搜尋 URL
const VENDOR_DOCS = {
  // ── 開源工具（可直接爬取 README / wiki）──
  'yosys': {
    name: 'Yosys',
    type: 'open-source',
    docs: [
      { topic: 'overview', url: 'https://raw.githubusercontent.com/YosysHQ/yosys/main/README.md' },
      { topic: 'commands', url: 'https://raw.githubusercontent.com/YosysHQ/yosys/main/README.md' },
      { topic: 'synthesis', url: 'https://raw.githubusercontent.com/YosysHQ/yosys/main/README.md' },
      { topic: 'abc', url: 'https://raw.githubusercontent.com/YosysHQ/yosys/main/README.md' },
    ],
    github: 'YosysHQ/yosys',
  },
  'openroad': {
    name: 'OpenROAD',
    type: 'open-source',
    docs: [
      { topic: 'overview', url: 'https://raw.githubusercontent.com/The-OpenROAD-Project/OpenROAD/master/README.md' },
      { topic: 'flow', url: 'https://openroad.readthedocs.io/en/latest/' },
      { topic: 'placement', url: 'https://openroad.readthedocs.io/en/latest/' },
      { topic: 'cts', url: 'https://openroad.readthedocs.io/en/latest/' },
      { topic: 'routing', url: 'https://openroad.readthedocs.io/en/latest/' },
    ],
    github: 'The-OpenROAD-Project/OpenROAD',
  },
  'verilator': {
    name: 'Verilator',
    type: 'open-source',
    docs: [
      { topic: 'overview', url: 'https://raw.githubusercontent.com/verilator/verilator/master/README.md' },
      { topic: 'usage', url: 'https://verilator.org/guide/latest/' },
      { topic: 'options', url: 'https://verilator.org/guide/latest/verilator.html' },
    ],
    github: 'verilator/verilator',
  },
  'klayout': {
    name: 'KLayout',
    type: 'open-source',
    docs: [
      { topic: 'overview', url: 'https://raw.githubusercontent.com/KLayout/klayout/master/README.md' },
      { topic: 'drc', url: 'https://www.klayout.de/doc-quantum/programming/index.html' },
      { topic: 'lvs', url: 'https://www.klayout.de/doc-quantum/programming/index.html' },
    ],
    github: 'KLayout/klayout',
  },
  'openlane': {
    name: 'OpenLane',
    type: 'open-source',
    docs: [
      { topic: 'overview', url: 'https://raw.githubusercontent.com/The-OpenROAD-Project/OpenLane/master/README.md' },
      { topic: 'flow', url: 'https://openlane.readthedocs.io/en/latest/' },
      { topic: 'configuration', url: 'https://openlane.readthedocs.io/en/latest/' },
    ],
    github: 'The-OpenROAD-Project/OpenLane',
  },
  'openSTA': {
    name: 'OpenSTA',
    type: 'open-source',
    docs: [
      { topic: 'overview', url: 'https://raw.githubusercontent.com/The-OpenROAD-Project/OpenSTA/master/README.md' },
      { topic: 'commands', url: 'https://raw.githubusercontent.com/The-OpenROAD-Project/OpenSTA/master/README.md' },
    ],
    github: 'The-OpenROAD-Project/OpenSTA',
  },
  'openRCX': {
    name: 'OpenRCX',
    type: 'open-source',
    docs: [
      { topic: 'overview', url: 'https://raw.githubusercontent.com/The-OpenROAD-Project/OpenRCX/master/README.md' },
    ],
    github: 'The-OpenROAD-Project/OpenRCX',
  },
  'openDB': {
    name: 'OpenDB',
    type: 'open-source',
    docs: [
      { topic: 'overview', url: 'https://raw.githubusercontent.com/The-OpenROAD-Project/OpenDB/master/README.md' },
    ],
    github: 'The-OpenROAD-Project/OpenDB',
  },
  'magic': {
    name: 'Magic VLSI',
    type: 'open-source',
    docs: [
      { topic: 'overview', url: 'https://raw.githubusercontent.com/RTimothyEdwards/magic/master/README' },
      { topic: 'drc', url: 'http://opencircuitdesign.com/magic/' },
    ],
    github: 'RTimothyEdwards/magic',
  },
  'netgen': {
    name: 'Netgen',
    type: 'open-source',
    docs: [
      { topic: 'overview', url: 'https://raw.githubusercontent.com/RTimothyEdwards/netgen/master/README' },
    ],
    github: 'RTimothyEdwards/netgen',
  },
  'ngspice': {
    name: 'ngspice',
    type: 'open-source',
    docs: [
      { topic: 'overview', url: 'https://ngspice.sourceforge.io/' },
      { topic: 'manual', url: 'https://ngspice.sourceforge.io/doc/manual.html' },
    ],
    github: 'ngspice/ngspice',
  },
  'qflow': {
    name: 'Qflow',
    type: 'open-source',
    docs: [
      { topic: 'overview', url: 'http://opencircuitdesign.com/qflow/' },
    ],
  },

  // ── 商業工具（常見 topic 文件段落索引）──
  'dc': {
    name: 'Design Compiler',
    type: 'commercial',
    vendor: 'synopsys',
    docs: [
      { topic: 'overview', excerpt: 'Design Compiler (DC) 是 Synopsys 的 RTL synthesis 工具。主要指令：analyze + elaborate + compile_ultra。支援 SDC constraint、UPF power intent。' },
      { topic: 'analyze', excerpt: 'analyze -format verilog {file.v} — 分析 RTL 語法。analyze -format sverilog {file.sv} — SystemVerilog。analyze -format vhdl {file.vhd} — VHDL。' },
      { topic: 'elaborate', excerpt: 'elaborate <module> — 展開 design hierarchy。elaborate <module> -parameters "WIDTH=8" — 帶參數。' },
      { topic: 'compile', excerpt: 'compile_ultra — 全自動 synthesis。compile_ultra -gate_clock — 加 clock gating。compile_ultra -timing_high_effort_script — 高 effort timing。compile_ultra -area_high_effort_script — 高 effort area。' },
      { topic: 'link', excerpt: "link — 連結 design 到 library。常見錯誤：'can't resolve reference' 通常是 library 路徑問題。set_app_var target_library [get_db libs .lib_name]。set_app_var link_library $target_library。" },
      { topic: 'timing', excerpt: 'report_timing -max_paths 10 — 檢查最差路徑。report_timing -delay_type max — setup check。report_timing -delay_type min — hold check。set_max_transition 0.5 [current_design]。' },
      { topic: 'area', excerpt: 'report_area — 回報面積。report_area -hierarchy — 階層式面積。set_max_area 0 — 不限面積。' },
      { topic: 'power', excerpt: 'report_power — 回報功耗。set_max_dynamic_power 0 — 不限動態功耗。set_max_leakage_power 0 — 不限漏電功耗。' },
      { topic: 'constraints', excerpt: 'create_clock -period 10 [get_ports clk] — 建立時脈。set_input_delay 2 -clock clk [get_ports in*] — 輸入延遲。set_output_delay 2 -clock clk [get_ports out*] — 輸出延遲。set_false_path -from [get_clocks clkA] -to [get_clocks clkB] — 跨時鐘域。' },
      { topic: 'output', excerpt: 'write -format ddc -hierarchy -output design.ddc — 寫 DDC。write -format verilog -hierarchy -output gate.v — 寫門級網表。write_sdc design.sdc — 寫 SDC。write_sdf design.sdf — 寫 SDF。' },
    ],
  },
  'innovus': {
    name: 'Innovus',
    type: 'commercial',
    vendor: 'cadence',
    docs: [
      { topic: 'overview', excerpt: 'Innovus 是 Cadence 的 P&R (Place & Route) 工具。主要流程：init_design → place_design → ccopt_design → route_design → optDesign。支援 MMMC timing、NanoRoute。' },
      { topic: 'init', excerpt: 'set init_verilog gate.v — 設定門級網表。set init_top_cell top — 設定頂層模組。set init_lef_file tech.lef std.lef — 設定 LEF。set init_mmmc_file MMMC.tcl — 設定 timing constraint。set init_cpf power.cpf — 設定 power。init_design — 初始化 design。' },
      { topic: 'placement', excerpt: 'place_design — placement。setPlaceMode -congEffort high — 高 effort placement。setPlaceMode -place_detail_legalization_inst_gap 1 — detail placement。place_detail — 微調 placement。' },
      { topic: 'cts', excerpt: 'ccopt_design — Clock Tree Synthesis (CCOpt)。set_ccopt_property -target_max_trans 0.15 — 設定 max transition。set_ccopt_property -target_skew 0.05 — 設定 target skew。ccopt_check_and_set_clock_trees — 檢查 clock tree。' },
      { topic: 'route', excerpt: 'route_design — routing。setNanoRouteMode -routeWithTimingDriven true — timing-driven routing。setNanoRouteMode -routeWithSiDriven true — SI-driven routing。routeDetail — detail routing。' },
      { topic: 'opt', excerpt: 'optDesign -preCTS — CTS 前優化。optDesign -postCTS — CTS 後優化。optDesign -postRoute — route 後優化。optDesign -postRoute -holdFix — hold 修復。' },
      { topic: 'timing', excerpt: 'timeDesign -preCTS — CTS 前 timing report。timeDesign -postCTS — CTS 後 timing。timeDesign -postRoute — route 後 timing。report_timing -max_paths 10 — 最差路徑。' },
      { topic: 'drc', excerpt: 'verify_drc — DRC 檢查。ecoRoute -fix_drc — 修復 DRC violation。verify_connectivity — 連接性檢查。' },
      { topic: 'power', excerpt: 'set_power_rail_analysis_strategy -method static — 靜態 IR drop。report_power — 功耗報告。set_pg_library_mode -celltype tech -extraction_tech_file tech.capTbl — PG 分析。' },
      { topic: 'output', excerpt: 'write_design -innovus -gzip -timing_merge_clock_gates -remove_clock_ports -overwrite — 寫出 design。write_parasitics -spef_file design.spef — 寫 SPEF。write_sdc -expand_pg -output design.sdc — 寫 SDC。' },
    ],
  },
  'primetime': {
    name: 'PrimeTime',
    type: 'commercial',
    vendor: 'synopsys',
    docs: [
      { topic: 'overview', excerpt: 'PrimeTime (PT) 是 Synopsys 的 sign-off STA 工具。讀取 gate-level netlist + liberty + SPEF + SDC，做精確 timing 分析。支援 OCV (On-Chip Variation)、CPPR。' },
      { topic: 'setup', excerpt: 'read_verilog gate.v — 讀取網表。read_liberty lib.db — 讀取 liberty。read_spef design.spef — 讀取 SPEF。read_sdc design.sdc — 讀取 SDC。current_design top — 設定 top design。' },
      { topic: 'timing', excerpt: 'report_timing — 預設 worst path。report_timing -max_paths 10 — 最差 10 條路徑。report_timing -delay_type max — setup check。report_timing -delay_type min — hold check。report_timing -from [get_clocks clkA] -to [get_clocks clkB] — 跨時鐘域。' },
      { topic: 'clock', excerpt: 'report_clock — 時脈資訊。report_clock_qors — clock QoR。report_clock -skew — clock skew。report_clock -latency — clock latency。' },
      { topic: 'constraints', excerpt: 'report_constraint -all_violators — 所有 constraint violation。report_constraint -max_transition — max transition。report_constraint -max_capacitance — max capacitance。report_constraint -min_period — min period。' },
      { topic: 'ocv', excerpt: 'set_timing_derate -late 1.05 [all_clocks] — OCV derate。set_timing_derate -early 0.95 [all_clocks] — early derate。report_analysis_coverage — coverage 報告。set_case_analysis 0 [get_ports scan_en] — 固定 scan signal。' },
      { topic: 'output', excerpt: 'report_timing > timing.rpt — 輸出 timing report。report_qor > qor.rpt — 輸出 QoR。write_sdf -version 2.1 design.sdf — 寫 SDF。write_sdc design.sdc — 寫 SDC。' },
    ],
  },
  'vcs': {
    name: 'VCS',
    type: 'commercial',
    vendor: 'synopsys',
    docs: [
      { topic: 'overview', excerpt: 'VCS 是 Synopsys 的 Verilog/SystemVerilog 模擬器。支援 UVM、SCOV coverage、FSM debug。vcs -sverilog +incdir+. — 編譯。./simv — 執行。' },
      { topic: 'compile', excerpt: 'vcs -sverilog -full64 file.sv — 編譯 SV。vcs +incdir+. -debug_access+all -kdb — 含 debug。vcs -sverilog -lca — LCA features。vcs -sverilog -timescale=1ns/1ps — 設定 timeunit。' },
      { topic: 'simulate', excerpt: './simv +fsdb+regions=0 — 執行。./simv +UVM_TESTNAME=test1 — UVM test。./simv -gui — DVE GUI。verdi -ssf waveform.fsdb — Verdi 看波形。' },
      { topic: 'debug', excerpt: '-debug_access+all — 全 debug。-kdb — KDB 資料庫（Verdi 用）。+vcs+flush+all — flush。+memcbk — memory callback。+fsdb+dumparray — array dump。' },
      { topic: 'coverage', excerpt: 'vcs -sverilog -cm cov — coverage。urg -dir simv.vdb — coverage report。+cover=bcefst — branch/condition/FSM/toggle。-cm_dir ./cov — coverage 目錄。' },
    ],
  },
  'xcelium': {
    name: 'Xcelium',
    type: 'commercial',
    vendor: 'cadence',
    docs: [
      { topic: 'overview', excerpt: 'Xcelium (原 IUS/NCSim) 是 Cadence 的多語言模擬器。支援 SystemVerilog、VHDL、UVM。xmvlog -sv file.sv — 編譯。xmsim simv — 執行。' },
      { topic: 'compile', excerpt: 'xmvlog -sv file.sv — 編譯 SV。xmvlog -sv -64bit — 64-bit。xmelab -sv work.top — elaboration。xmsim -a simv — 執行。' },
      { topic: 'debug', excerpt: 'xmsim -gui — SimVision GUI。xmsim -access +rwc — read/write/cont。xmsim -sv_lib mylib — 外部 SV library。+access+rw — 權限。' },
    ],
  },
  'vivado': {
    name: 'Vivado',
    type: 'commercial',
    vendor: 'xilinx',
    docs: [
      { topic: 'overview', excerpt: 'Vivado 是 AMD/Xilinx 的 FPGA 設計工具。支援 RTL synthesis、implementation、bitstream 生成。Vivado -mode batch -source script.tcl — batch 模式。' },
      { topic: 'synthesis', excerpt: 'synth_design -top top -part xc7a100tcsg324-1 — synthesis。synth_design -flatten_hierarchy rebuilt — flatten。report_utilization — 資源使用量。report_timing_summary — timing summary。' },
      { topic: 'implementation', excerpt: 'opt_design — optimization。place_design — placement。route_design — routing。report_timing_summary -delay_type min_max — full timing。' },
      { topic: 'constraints', excerpt: 'create_clock -period 10.000 -name clk [get_ports clk] — 時脈。set_false_path -from [get_clocks clkA] -to [get_clocks clkB] — 跨時鐘域。set_multicycle_path -setup 2 -from [get_pins reg/C] — multicycle。' },
      { topic: 'debug', excerpt: 'ILA (Integrated Logic Analyzer)：insert_debug_probes — 插入 debug。VIO (Virtual I/O)：create_debug_core — 虛擬 I/O。' },
      { topic: 'power', excerpt: 'report_power — 功耗報告。set_power_opt_design — power optimization。report_power -hierarchy — 階層式功耗。' },
    ],
  },
  'calibre': {
    name: 'Calibre',
    type: 'commercial',
    vendor: 'siemens',
    docs: [
      { topic: 'overview', excerpt: 'Calibre 是 Siemens EDA 的 sign-off 驗證工具。包含 DRC (Design Rule Check)、LVS (Layout vs. Schematic)、PEX (Parasitic Extraction)。' },
      { topic: 'drc', excerpt: 'calibre -drc rules.svrf — 執行 DRC。rules.svrf 是 DRC rule deck。RVE (Results Viewing Environment) 檢查結果。常見：spacing/width/enclosure/area violation。' },
      { topic: 'lvs', excerpt: 'calibre -lvs rules.svrf — 執行 LVS。比對 layout vs schematic netlist。常見 mismatch：missing net、wrong device count、wrong connectivity。' },
      { topic: 'pex', excerpt: 'calibre -xrc rules.svrf — parasitic extraction。生成 SPEF/SDF/SPICE。calibre -xrc -spice rules.svrf — SPICE extraction。' },
    ],
  },
  'icc2': {
    name: 'IC Compiler II',
    type: 'commercial',
    vendor: 'synopsys',
    docs: [
      { topic: 'overview', excerpt: 'ICC2 (IC Compiler II) 是 Synopsys 的 P&R 工具。讀取 .ddc/.vg/.sdc/.lib。主要流程：read_design → place_opt → cts_opt → route_opt。' },
      { topic: 'setup', excerpt: 'read_verilog gate.v — 讀取網表。read_lib lib.db — 讀取 liberty。read_sdc design.sdc — 讀取 SDC。read_physical -lef tech.lef — 讀取 LEF。' },
      { topic: 'place', excerpt: 'place_opt — placement + optimization。set_app_options -name place.coarse.max_density -value 0.8 — density 控制。place_detail — detail placement。' },
      { topic: 'cts', excerpt: 'clock_opt — CTS + optimization。set_app_options -name cts.compile.target_max_trans -value 0.15 — max transition。set_app_options -name cts.compile.target_skew -value 0.05 — target skew。' },
      { topic: 'route', excerpt: 'route_opt — routing + optimization。set_app_options -name route.global.timing_effort -value high — timing-driven。set_app_options -name route.detail.antenna_fix -value true — antenna fix。' },
    ],
  },
  'genus': {
    name: 'Genus',
    type: 'commercial',
    vendor: 'cadence',
    docs: [
      { topic: 'overview', excerpt: 'Genus 是 Cadence 的 RTL synthesis 工具。支援 Conformal equivalence checking、temporal partitioning。read_file -sv file.sv — 讀取。elaborate top — 展開。synthesize -map_effort high — synthesis。' },
      { topic: 'synthesis', excerpt: 'synthesize -map_effort high — synthesis。set_db syn_generic_effort high — generic effort。set_db syn_map_effort high — map effort。write -format verilog -hierarchy -output gate.v — 輸出。' },
    ],
  },
  'tempus': {
    name: 'Tempus',
    type: 'commercial',
    vendor: 'cadence',
    docs: [
      { topic: 'overview', excerpt: 'Tempus 是 Cadence 的 sign-off STA 工具。讀取 gate-level netlist + liberty + SPEF + SDC。支援 SI analysis、OCV。read_verilog gate.v — 讀取網表。read_liberty lib.lib — 讀取 liberty。' },
      { topic: 'timing', excerpt: 'report_timing — worst path。report_timing -max_paths 10 — top 10。report_timing -early — hold check。report_timing -late — setup check。report_constraint -all_violators — constraint violations。' },
    ],
  },
  'starrc': {
    name: 'StarRC',
    type: 'commercial',
    vendor: 'synopsys',
    docs: [
      { topic: 'overview', excerpt: 'StarRC 是 Synopsys 的 parasitic extraction 工具。從 layout 提取 RC parasitics。輸出 SPEF/SDF。' },
      { topic: 'extraction', excerpt: '星際大战 extraction 指令：STARXT -65 *.gds *.spice tech.tluplus — extraction。SPEF output: *.spef。SDF output: *.sdf。' },
    ],
  },
  'quantus': {
    name: 'Quantus',
    type: 'commercial',
    vendor: 'cadence',
    docs: [
      { topic: 'overview', excerpt: 'Quantus 是 Cadence 的 parasitic extraction 工具。支援 QRC extraction。從 LEF/DEF + tech file 提取 RC。' },
    ],
  },
  'spyglass': {
    name: 'SpyGlass',
    type: 'commercial',
    vendor: 'synopsys',
    docs: [
      { topic: 'overview', excerpt: 'SpyGlass 是 Synopsys 的 RTL lint/CDC/RDC 檢查工具。spyglass -interactive — 互動模式。read_file -sv file.sv — 讀取。current_fileset — 設定 current fileset。' },
      { topic: 'lint', excerpt: 'SpyGlass-Lint: set_option enableSV yes — 啟用 SV。set_option stop_on_error yes — error 時停止。run_goal lint/lint_rtl — 執行 lint。' },
      { topic: 'cdc', excerpt: 'SpyGlass-CDC: run_goal cdc/cdc_verify — CDC 檢查。set_option enableCDC yes — 啟用 CDC。set_option cdc_strobe true — strobe mode。' },
    ],
  },
  'formality': {
    name: 'Formality',
    type: 'commercial',
    vendor: 'synopsys',
    docs: [
      { topic: 'overview', excerpt: 'Formality 是 Synopsys 的 LEC (Logic Equivalence Check) 工具。比對 golden (RTL) vs implementation (gate-level)。set_svf design.svf — 設定 SVF。read_verilog -r golden.v — reference。read_verilog -i impl.v — implementation。' },
      { topic: 'verify', excerpt: 'match — 比對 gate。verify — 驗證等價。report_failing — 失敗報告。report_statistics — 統計。set_constant r:/top/scan_en 0 — 固定 constant。' },
    ],
  },
  'lec': {
    name: 'Conformal LEC',
    type: 'commercial',
    vendor: 'cadence',
    docs: [
      { topic: 'overview', excerpt: 'Conformal LEC 是 Cadence 的 Logic Equivalence Check 工具。比對 golden vs implementation。read design -golden golden.v -revised impl.v — 讀取。set_system mode setup — 設定模式。' },
      { topic: 'verify', excerpt: 'set_system mode setup — 設定。read design -golden golden.v — reference。read design -revised impl.v — implementation。set_constant r:top/scan_en 0 — constant。verify — 執行。report failed -detail — 失敗報告。' },
    ],
  },
  'questa': {
    name: 'Questa',
    type: 'commercial',
    vendor: 'siemens',
    docs: [
      { topic: 'overview', excerpt: 'Questa (原 ModelSim) 是 Siemens EDA 的模擬器。支援 SystemVerilog、UVM、Coverage。vlog -sv file.sv — 編譯。vsim top — 執行。' },
      { topic: 'compile', excerpt: 'vlog -sv file.sv — 編譯 SV。vlog +acc — access。vlog -timescale \"1ns/1ps\" — timeunit。vopt +acc top — 優化。' },
      { topic: 'simulate', excerpt: 'vsim -c top — command-line。vsim -gui top — GUI。vsim -coverage top — coverage。run 1000 — 執行 1000 time units。run -all — 執行到結束。' },
    ],
  },
  'modelsim': {
    name: 'ModelSim',
    type: 'commercial',
    vendor: 'siemens',
    docs: [
      { topic: 'overview', excerpt: 'ModelSim 是 Siemens EDA (Mentor) 的 VHDL/Verilog 模擬器。vcom file.vhd — VHDL。vlog file.v — Verilog。vsim -voptargs=+acc top — 模擬。' },
    ],
  },
  'jaspergold': {
    name: 'JasperGold',
    type: 'commercial',
    vendor: 'cadence',
    docs: [
      { topic: 'overview', excerpt: 'JasperGold 是 Cadence 的 formal verification 工具。支援 formal property verification、formal equivalence、CDC verification。read_verilog file.sv — 讀取。set_property FILE <file> [find -expression <expr>] — 設定。' },
    ],
  },
  'vc_formal': {
    name: 'VC Formal',
    type: 'commercial',
    vendor: 'synopsys',
    docs: [
      { topic: 'overview', excerpt: 'VC Formal 是 Synopsys 的 formal verification 工具。支援 FPV、APP、ABD。read_verilog -sv file.sv — 讀取。set_options -kinduction true — induction。 prove -show_constraints — prove。' },
    ],
  },
  'modus': {
    name: 'Modus',
    type: 'commercial',
    vendor: 'cadence',
    docs: [
      { topic: 'overview', excerpt: 'Modus 是 Cadence 的 DFT (Design-for-Test) 工具。自動 ATPG pattern 生成、BIST、compression。read_design -netlist gate.v — 讀取。set_context -scan — 設定 scan。' },
    ],
  },
  'dft_compiler': {
    name: 'DFT Compiler',
    type: 'commercial',
    vendor: 'synopsys',
    docs: [
      { topic: 'overview', excerpt: 'DFT Compiler 是 Synopsys 的 DFT insertion 工具。scan chain insertion、BIST、OPCG。set_scan_path — 設定 scan chain。insert_dft — 執行 DFT insertion。' },
      { topic: 'scan', excerpt: 'set_scan_style -mixed_flow scan — scan style。set_scan_enable_signal scan_en — scan enable。insert_dft — 插入 scan chain。' },
    ],
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

// ── 文件爬取（開源工具 GitHub raw）─────────────────────────────────────────────
async function fetchDocContent(toolKey, topic) {
  const docInfo = VENDOR_DOCS[toolKey];
  if (!docInfo) return null;

  // 開源工具：從 GitHub raw URL 爬取
  if (docInfo.type === 'open-source') {
    const doc = docInfo.docs.find(d => d.topic === topic) || docInfo.docs[0];
    if (!doc || !doc.url) return null;
    try {
      // 用 text fetch（非 JSON）
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(doc.url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const content = await resp.text();
      // 截取前 3000 字元（避免太長）
      const truncated = content.length > 3000 ? content.slice(0, 3000) + '\n\n... (內容已截斷)' : content;
      return {
        tool: docInfo.name,
        topic: doc.topic,
        source: doc.url,
        type: 'fetched',
        content: truncated,
      };
    } catch (err) {
      return { tool: docInfo.name, topic, source: doc.url, type: 'error', error: err.message };
    }
  }

  // 商業工具：返回索引的 excerpt
  if (docInfo.type === 'commercial') {
    const docs = topic
      ? docInfo.docs.filter(d => d.topic === topic || d.topic === 'overview')
      : docInfo.docs.slice(0, 3); // 預設返回前 3 個 topic
    if (docs.length === 0) return null;
    return {
      tool: docInfo.name,
      topic: topic || 'overview',
      type: 'indexed',
      vendor: docInfo.vendor,
      excerpts: docs.map(d => ({ topic: d.topic, content: d.excerpt })),
      solvnet: docInfo.vendor === 'synopsys'
        ? `https://solvnet.synopsys.com/solve/qa?search=${encodeURIComponent(docInfo.name + ' ' + (topic || ''))}`
        : docInfo.vendor === 'cadence'
        ? `https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution`
        : null,
    };
  }

  return null;
}

// 偵測 query 中的 topic 關鍵字
function detectDocTopic(query) {
  const q = query.toLowerCase();
  const topicMap = [
    ['overview', /overview|introduction|what is|介紹|概觀|概述/i],
    ['analyze', /analyze|analysis|分析/i],
    ['elaborate', /elaborate|展開/i],
    ['compile', /compile|synthesis|合成|編譯/i],
    ['link', /link|連結|連接/i],
    ['timing', /timing|時序|時脈|STA|setup|hold/i],
    ['area', /area|面積/i],
    ['power', /power|功耗|漏電/i],
    ['constraints', /constraint|SDC|constraint|set_clock|set_input|set_output/i],
    ['output', /output|write|write_sdc|write_sdf|輸出/i],
    ['placement', /place|placement|配置/i],
    ['cts', /cts|clock tree|時脈樹/i],
    ['route', /route|routing|繞線/i],
    ['opt', /opt|optimize|優化/i],
    ['drc', /DRC|design rule/i],
    ['lvs', /LVS|layout vs schematic/i],
    ['pex', /PEX|parasitic extraction|寄生/i],
    ['setup', /setup|initial|init|初始化/i],
    ['simulate', /simulate|simulation|模擬/i],
    ['debug', /debug|除錯|調試/i],
    ['coverage', /coverage|覆蓋率/i],
    ['lint', /lint|語法/i],
    ['cdc', /CDC|clock domain crossing/i],
    ['verify', /verify|verification| equivalence|等價/i],
    ['scan', /scan chain|scan insertion/i],
    ['ocv', /OCV|on-chip variation/i],
    ['clock', /clock|skew|latency/i],
    ['extraction', /extraction|提取/i],
  ];
  for (const [topic, pattern] of topicMap) {
    if (pattern.test(q)) return topic;
  }
  return null;
}

// ── 廠商 Q&A 搜尋 ─────────────────────────────────────────────────────────
// 偵測 tool 問題時，自動生成 SolvNet / Cadence Support 搜尋 URL
function generateVendorSearchURL(toolName, query) {
  const toolLower = toolName.toLowerCase();
  const searchQuery = encodeURIComponent(`${query} ${toolName}`);
  const urls = [];

  // Synopsys 工具 → SolvNet
  if (['design compiler', 'dc', 'vcs', 'primetime', 'pt', 'formality', 'fmod', 'icc2', 'dc explorer', 'spyglass'].some(t => toolLower.includes(t))) {
    urls.push({
      vendor: 'Synopsys SolvNet',
      url: `https://solvnet.synopsys.com/solve/qa?search=${searchQuery}`,
      note: 'Synopsys 官方 Q&A 知識庫',
    });
  }

  // Cadence 工具 → Cadence Support
  if (['innovus', 'xcelium', 'conformal', 'lec', 'virtuoso', 'tempus', 'voltus', 'genus', ' JasperGold', 'Stratus'].some(t => toolLower.includes(t))) {
    urls.push({
      vendor: 'Cadence Online Support',
      url: `https://support.cadence.com/apex/ArticleAttachmentPortal?id=a1O3w000009lpPjEAI&pageName=ArticleContentView&pub=solution&q=${searchQuery}`,
      note: 'Cadence 官方技術支援',
    });
  }

  // Siemens (Calibre) → Siemens EDA Support
  if (toolLower.includes('calibre') || toolLower.includes('siemens') || toolLower.includes('icv') || toolLower.includes('mGCAR')) {
    urls.push({
      vendor: 'Siemens EDA Support',
      url: `https://eda.com/support/calibre`,
      note: 'Siemens EDA (Calibre) 支援中心',
    });
  }

  // Xilinx/AMD → Xilinx Support
  if (toolLower.includes('vivado') || toolLower.includes('xilinx') || toolLower.includes('quartus')) {
    urls.push({
      vendor: 'AMD/Xilinx Support',
      url: `https://support.xilinx.com/s/global-search/${searchQuery}`,
      note: 'AMD/Xilinx 官方支援中心',
    });
  }

  // Intel → Intel Support
  if (toolLower.includes('quartus') || toolLower.includes('intel') || toolLower.includes('altera')) {
    urls.push({
      vendor: 'Intel Support',
      url: `https://www.intel.com/content/www/us/en/search.html?#q=${searchQuery}&t=All`,
      note: 'Intel FPGA 支援中心',
    });
  }

  // 通用搜尋 fallback
  if (urls.length === 0) {
    urls.push({
      vendor: 'Google',
      url: `https://www.google.com/search?q=${searchQuery}+error+solution+site:solvnet.synopsys.com+OR+site:support.cadence.com`,
      note: '通用 EDA 問題搜尋',
    });
  }

  return urls;
}

// 從 TOOL_FAQ_INDEX 搜尋匹配的 FAQ
function searchToolFAQ(query, toolFilter) {
  const q = query.toLowerCase();
  const results = [];

  for (const [toolId, toolData] of Object.entries(TOOL_FAQ_INDEX)) {
    // 如果有 tool filter，只搜尋指定工具
    if (toolFilter && !toolId.includes(toolFilter.toLowerCase()) && !toolData.tool.toLowerCase().includes(toolFilter.toLowerCase())) {
      continue;
    }

    for (const faq of toolData.faqs) {
      // 用 regex pattern 匹配錯誤訊息
      if (faq.pattern.test(query)) {
        results.push({
          tool: toolData.tool,
          error: faq.error,
          cause: faq.cause,
          solution: faq.solution,
          solvnet: faq.solvnet,
        });
      }
    }
  }

  // 如果 regex 沒匹配，用 word overlap 做 fuzzy 搜尋
  if (results.length === 0) {
    const words = q.split(/\s+/).filter(w => w.length > 2);
    for (const [toolId, toolData] of Object.entries(TOOL_FAQ_INDEX)) {
      if (toolFilter && !toolId.includes(toolFilter.toLowerCase()) && !toolData.tool.toLowerCase().includes(toolFilter.toLowerCase())) {
        continue;
      }

      for (const faq of toolData.faqs) {
        const faqText = `${faq.error} ${faq.cause} ${faq.solution}`.toLowerCase();
        const overlap = words.filter(w => faqText.includes(w));
        if (overlap.length >= Math.ceil(words.length * 0.4) || overlap.length >= 2) {
          results.push({
            tool: toolData.tool,
            error: faq.error,
            cause: faq.cause,
            solution: faq.solution,
            solvnet: faq.solvnet,
            matchScore: overlap.length / words.length,
          });
        }
      }
    }
    // 按 matchScore 排序
    results.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  }

  return results.slice(0, 5);
}

// ── auto 模式：偵測 tool 問題查詢 ──────────────────────────────────────────────
const TOOL_ISSUE_PATTERNS = [
  /error/i, /issue/i, /problem/i, /fail/i, /not found/i,
  /cannot/i, /can't/i, /unable/i, /missing/i, /undefined/i,
  /violation/i, /mismatch/i, /conflict/i, /exception/i,
  /bug/i, /crash/i, /hang/i, /stuck/i, /timeout/i,
  /help/i, /fix/i, /solve/i, /debug/i, /troubleshoot/i,
  /warning/i, /not met/i, /critical/i, /concern/i,
  /improve/i, /optimize/i, /degraded/i, /slow/i,
  /incorrect/i, /wrong/i, /unexpected/i, /strange/i,
  /refuse/i, /reject/i, /ignore/i, /skip/i,
];

function isToolIssueQuery(query) {
  return TOOL_ISSUE_PATTERNS.some(p => p.test(query));
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
// 1b. DuckDuckGo Web Search — 廣域網路搜尋（免 API key）
// ═══════════════════════════════════════════════════════════════════════════════

async function searchWebDDG(query, maxResults = 8) {
  try {
    const params = new URLSearchParams({ q: query, t: 'h_', ia: 'web' });
    const resp = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: params.toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    // Parse lite HTML — each result is in a <td class="result-link"> block
    const results = [];
    const linkRegex = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>\s*([^<]+)\s*<\/a>/gi;
    const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
    const links = [];
    const snippets = [];
    let m;
    while ((m = linkRegex.exec(html)) !== null) links.push({ url: m[1].trim(), title: m[2].trim() });
    while ((m = snippetRegex.exec(html)) !== null) snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
    for (let i = 0; i < Math.min(links.length, maxResults, snippets.length); i++) {
      if (links[i].url.startsWith('http')) {
        results.push({ title: links[i].title, url: links[i].url, snippet: snippets[i] || '' });
      }
    }
    return results;
  } catch { return []; }
}

function formatWebResults(results, title = '🌐 網路搜尋') {
  if (!results || results.length === 0) return `${title}：無結果\n`;
  let out = `${title}（${results.length} 筆）\n\n`;
  for (const r of results) {
    out += `### [${r.title}](${r.url})\n`;
    if (r.snippet) out += `> ${r.snippet.slice(0, 200)}\n`;
    out += '\n';
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1c. EDA Community Search — Cadence/Synopsys/EE Times/Reddit 社群
// ═══════════════════════════════════════════════════════════════════════════════

const EDA_COMMUNITIES = [
  { name: 'Cadence Community', domain: 'community.cadence.com', queryTemplate: (q) => `site:community.cadence.com ${q}` },
  { name: 'Synopsys SolvNet', domain: 'solvnet.synopsys.com', queryTemplate: (q) => `site:solvnet.synopsys.com ${q}` },
  { name: 'EE Times', domain: 'eetimes.com', queryTemplate: (q) => `site:eetimes.com EDA ASIC ${q}` },
  { name: 'Reddit r/ASIC', domain: 'reddit.com/r/ASIC', queryTemplate: (q) => `site:reddit.com/r/ASIC ${q}` },
  { name: 'Reddit r/FPGA', domain: 'reddit.com/r/FPGA', queryTemplate: (q) => `site:reddit.com/r/FPGA ${q}` },
  { name: 'EDAboard', domain: 'edaboard.com', queryTemplate: (q) => `site:edaboard.com ${q}` },
  { name: 'ChipVerify', domain: 'chipverify.com', queryTemplate: (q) => `site:chipverify.com ${q}` },
  { name: 'Verification Academy', domain: 'verificationacademy.com', queryTemplate: (q) => `site:verificationacademy.com ${q}` },
];

async function searchEDACommunities(query, maxResults = 10) {
  // 用一條 broadly query 搜所有社群（避免 rate limit）
  const broadQuery = `EDA ASIC IC design ${query}`;
  const results = await searchWebDDG(broadQuery, maxResults);
  // 標記來自已知社群的結果
  return results.map(r => {
    const matched = EDA_COMMUNITIES.find(c => r.url.includes(c.domain));
    return { ...r, community: matched ? matched.name : null };
  });
}

function formatCommunityResults(results) {
  if (!results || results.length === 0) return '💬 EDA 社群：無結果\n';
  let out = `💬 EDA 社群討論（${results.length} 筆）\n\n`;
  for (const r of results) {
    const badge = r.community ? ` [${r.community}]` : '';
    out += `###${badge} [${r.title}](${r.url})\n`;
    if (r.snippet) out += `> ${r.snippet.slice(0, 200)}\n`;
    out += '\n';
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
    'EDA', 'VLSI', 'ASIC', 'FPGA', 'FinFET', 'CMOS', 'liberty', '.lib', 'characterize',
    'clock mux', 'CDC', 'metastability', 'synchronizer', 'UPF', 'power domain',
    'multi-cycle', 'false path', 'clock gating', 'OCV', 'AOCV', 'POCV'];
  const hasEDAKeyword = edaKeywords.some(k => query.toLowerCase().includes(k.toLowerCase()));
  if (hasEDAKeyword) return query;
  // 否則加上 EDA 背景
  return `${query} VLSI EDA IC design`;
}

// 為不同搜尋來源生成最佳化查詢
function generateSearchQueries(originalQuery, context = 'general') {
  const q = originalQuery.toLowerCase();
  const queries = { web: '', community: '', academic: '', github: '' };
  
  // 基礎查詢
  const base = originalQuery;
  
  // Web 搜尋：加入 troubleshoot / solution / how to
  if (q.includes('error') || q.includes('fail') || q.includes('問題') || q.includes('fix')) {
    queries.web = `${base} EDA solution fix troubleshooting`;
  } else if (q.includes('how to') || q.includes('怎么') || q.includes('如何') || q.includes('方法')) {
    queries.web = `${base} EDA methodology best practice`;
  } else {
    queries.web = `${base} EDA ASIC IC design`;
  }
  
  // Community 搜尋：加入 forum / discussion / experience
  queries.community = `${base} site:community.cadence.com OR site:solvnet.synopsys.com OR site:reddit.com/r/ASIC OR site:edaboard.com`;
  
  // Academic 搜尋：加入 paper / survey / analysis
  queries.academic = `${base} VLSI ASIC survey analysis`;
  
  // GitHub 搜尋：加入 script / tool / flow / example
  queries.github = `${base} liberty script tool flow example`;
  
  return queries;
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

        // EDA 工具查詢（優先：tool 問題偵測需要先判斷）
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

          // 偵測 tool 問題 → 自動補充 FAQ + 廠商 URL
          if (isToolIssueQuery(searchQuery)) {
            // 找出 query 中明確提到的 tool（取最精確匹配）
            const toolKeys = Object.keys(EDA_TOOL_INDEX).filter(k => q.includes(k));
            const detectedTool = toolKeys.length > 0 ? toolKeys[0] : null;
            const faqResults = searchToolFAQ(searchQuery, detectedTool);
            console.log('[DEBUG auto-faq] q:', q, 'toolKeys:', toolKeys, 'detectedTool:', detectedTool, 'faqCount:', faqResults.length);
            if (faqResults.length > 0) {
              output += `\n## 🔧 偵測到 Tool 問題，自動補充 FAQ：\n\n`;
              for (const faq of faqResults.slice(0, 3)) {
                output += `### 🔴 ${faq.error}\n`;
                output += `**原因**：${faq.cause}\n\n`;
                output += `**解決方案**：\n\n${faq.solution}\n\n`;
                if (faq.solvnet) output += `📎 [廠商 Q&A](${faq.solvnet})\n\n`;
              }
              const toolName = detectedTool ? EDA_TOOL_INDEX[detectedTool]?.name : searchQuery;
              const vendorURLs = generateVendorSearchURL(toolName, searchQuery);
              if (vendorURLs.length > 0) {
                output += `## 🔗 廠商支援資源\n\n`;
                for (const vu of vendorURLs) {
                  output += `- [${vu.vendor}](${vu.url}) — ${vu.note}\n`;
                }
              }
            }
          }

          return { ok: true, output: output || '🔍 自動搜尋：未找到 EDA 工具相關結果' };
        }

        // PDK 相關查詢
        if (q.includes('pdk') || q.includes('sky') || q.includes('asap') || q.includes('cell lib')
          || q.includes('130nm') || q.includes('7nm') || q.includes('45nm') || q.includes('180nm')
          || q.includes('finfet') || q.includes('gf180') || q.includes('nangate')) {
          const localPDK = searchLocalPDK(searchQuery);
          let output = '';
          if (localPDK.length > 0) {
            output += formatPDKResults(localPDK) + '\n';
          }
          try {
            const ghResults = await searchGitHubPDK(searchQuery, 5);
            output += formatGitHubResults(ghResults, 'GitHub 相關 PDK 專案');
          } catch { /* ignore */ }
          return { ok: true, output: output || '🔍 自動搜尋：未找到 PDK 相關結果' };
        }

        // ── 多源並行廣搜（使用多維度查詢）──
        const searchQueries = generateSearchQueries(searchQuery);
        const enhancedQuery = enhanceQueryForEDA(searchQuery);
        const sources = await Promise.allSettled([
          // 1. 網路搜尋（DuckDuckGo）— 廣域覆蓋，使用優化查詢
          searchWebDDG(searchQueries.web, maxResults),
          // 2. EDA 社群搜尋（Cadence/Synopsys/Reddit/EE Times）— 使用社群查詢
          searchEDACommunities(searchQuery, maxResults),
          // 3. Semantic Scholar 學術論文 — 使用學術查詢
          searchSemanticScholar(searchQueries.academic || enhancedQuery, maxResults).then(r => r.ok ? r.data : []),
          // 4. OpenAlex 學術論文
          searchOpenAlex(searchQueries.academic || enhancedQuery, Math.min(maxResults, 5)),
          // 5. GitHub code search — 使用 GitHub 查詢
          searchGitHubCode(searchQueries.github, 5),
          // 6. GitHub repo search — 找相關 EDA 專案
          searchGitHubEDA(searchQuery, 5),
        ]);

        let output = '';

        // 網路搜尋結果（最廣覆蓋）
        const webResults = sources[0].status === 'fulfilled' ? sources[0].value : [];
        if (webResults.length > 0) output += formatWebResults(webResults);

        // EDA 社群結果
        const communityResults = sources[1].status === 'fulfilled' ? sources[1].value : [];
        if (communityResults.length > 0) output += formatCommunityResults(communityResults);

        // Semantic Scholar
        const scholarData = sources[2].status === 'fulfilled' ? sources[2].value : [];
        if (scholarData.length > 0) output += formatSemanticScholarResults(scholarData);

        // OpenAlex
        const articles = sources[3].status === 'fulfilled' ? sources[3].value : [];
        if (articles.length > 0) output += formatOpenAlexResults(articles);

        // GitHub code — 實際 script / flow
        const ghCode = sources[4].status === 'fulfilled' ? sources[4].value : [];
        if (ghCode.length > 0) {
          output += `💻 **GitHub 程式碼**（相關 script / tool flow）\n\n`;
          for (const r of ghCode) {
            output += `- [${r.name}](${r.url}) — *${r.repo}*\n`;
          }
          output += '\n';
        }

        // GitHub repo
        const ghRepos = sources[5].status === 'fulfilled' ? sources[5].value : [];
        if (ghRepos.length > 0) output += formatGitHubResults(ghRepos, 'GitHub 相關 EDA 專案');

        // 偵測是否提到特定會議
        const conf = detectConference(searchQuery);
        if (conf) {
          output += `\n💡 偵測到會議 **${conf}**，建議搜尋：\n`;
          output += `  • [ACM Digital Library](https://dl.acm.org/doi/proceedings/${conf})\n`;
          output += `  • [IEEE Xplore](https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${conf}%20EDA)\n`;
          output += `  • [dblp](https://dblp.org/search?q=${conf})\n`;
        }

        // 提示：如需更深入搜尋可用 smart_exa_search
        if (!output || output.length < 100) {
          output += `\n💡 如需更深入搜尋，可用 \`smart_exa_search\` 查詢：\n`;
          output += `  \`smart_exa_search({command:"search", query:"${searchQuery}", numResults:10})\`\n`;
        }

        return { ok: true, output: output || '🔍 自動搜尋：無結果' };
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

      // ── PDK + Tool + Paper + Web + Community 綜合搜尋 ──
      case 'all':
      case 'comprehensive': {
        let output = '';

        // PDK
        const localPDK = searchLocalPDK(searchQuery);
        if (localPDK.length > 0) output += formatPDKResults(localPDK);

        // Tools
        const localTools = searchLocalTools(searchQuery);
        if (localTools.length > 0) output += formatToolResults(localTools);

        // 多源並行搜尋（使用多維度查詢）
        const allSearchQueries = generateSearchQueries(searchQuery);
        const allEnhancedQuery = enhanceQueryForEDA(searchQuery);
        const allSources = await Promise.allSettled([
          searchWebDDG(allSearchQueries.web, maxResults),
          searchEDACommunities(searchQuery, maxResults),
          searchSemanticScholar(allSearchQueries.academic || allEnhancedQuery, 5).then(r => r.ok ? r.data : []),
          searchOpenAlex(allSearchQueries.academic || allEnhancedQuery, 5),
          searchGitHubEDA(searchQuery, 5),
          searchGitHubCode(allSearchQueries.github, 5),
        ]);

        const allWeb = allSources[0].status === 'fulfilled' ? allSources[0].value : [];
        if (allWeb.length > 0) output += formatWebResults(allWeb);

        const allCommunity = allSources[1].status === 'fulfilled' ? allSources[1].value : [];
        if (allCommunity.length > 0) output += formatCommunityResults(allCommunity);

        const allScholar = allSources[2].status === 'fulfilled' ? allSources[2].value : [];
        if (allScholar.length > 0) output += formatSemanticScholarResults(allScholar);

        const allArticles = allSources[3].status === 'fulfilled' ? allSources[3].value : [];
        if (allArticles.length > 0) output += formatOpenAlexResults(allArticles);

        const allGH = allSources[4].status === 'fulfilled' ? allSources[4].value : [];
        if (allGH.length > 0) output += formatGitHubResults(allGH, 'GitHub 相關專案');

        const allGHCode = allSources[5].status === 'fulfilled' ? allSources[5].value : [];
        if (allGHCode.length > 0) {
          output += `💻 **GitHub 程式碼**\n\n`;
          for (const r of allGHCode) output += `- [${r.name}](${r.url}) — *${r.repo}*\n`;
          output += '\n';
        }

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

      // ── Tool Troubleshooting（FAQ + 廠商搜尋 URL）──
      case 'troubleshoot': {
        let output = `🔧 **EDA Tool Troubleshooting**\n\n`;
        const qLower = searchQuery.toLowerCase();

        // 1. 偵測提到的工具名稱
        const toolNames = Object.keys(EDA_TOOL_INDEX).filter(k => qLower.includes(k));
        const detectedTool = toolNames.length > 0 ? toolNames[0] : null;

        // 2. 從 FAQ 索引搜尋
        const faqResults = searchToolFAQ(searchQuery, detectedTool);
        if (faqResults.length > 0) {
          output += `## 📋 常見問題解答（FAQ）\n\n`;
          for (const faq of faqResults) {
            output += `### 🔴 ${faq.error}\n`;
            output += `**工具**：${faq.tool}\n\n`;
            output += `**原因**：${faq.cause}\n\n`;
            output += `**解決方案**：\n\n${faq.solution}\n\n`;
            if (faq.solvnet) output += `📎 [廠商 Q&A](${faq.solvnet})\n\n`;
          }
        }

        // 3. 廠商搜尋 URL
        const toolName = detectedTool ? EDA_TOOL_INDEX[detectedTool]?.name : searchQuery;
        const vendorURLs = generateVendorSearchURL(toolName, searchQuery);
        if (vendorURLs.length > 0) {
          output += `## 🔗 廠商支援資源\n\n`;
          for (const vu of vendorURLs) {
            output += `- [${vu.vendor}](${vu.url}) — ${vu.note}\n`;
          }
          output += '\n';
        }

        // 4. 補充建議
        if (faqResults.length === 0 && vendorURLs.length === 0) {
          output += `⚠️ 未找到本地 FAQ 匹配。建議\n`;
          output += `1. 用 \`action=troubleshoot\` 加上具體錯誤訊息\n`;
          output += `2. 用 \`action=paper\` 搜尋相關學術論文\n`;
          output += `3. 用 \`action=github\` 搜尋 GitHub 上的討論\n`;
        }

        return { ok: true, output: output || '🔍 Troubleshooting：請提供具體錯誤訊息' };
      }

      // ── Tool 文件查詢（爬取 user guide / excerpt）──
      case 'docs': {
        const qLower = searchQuery.toLowerCase();
        // 偵測提到的工具
        const docToolKeys = Object.keys(VENDOR_DOCS).filter(k => qLower.includes(k));
        if (docToolKeys.length === 0) {
          // 嘗試用 EDA_TOOL_INDEX 找
          const toolKeys = Object.keys(EDA_TOOL_INDEX).filter(k => qLower.includes(k));
          if (toolKeys.length > 0 && VENDOR_DOCS[toolKeys[0]]) {
            docToolKeys.push(toolKeys[0]);
          }
        }
        if (docToolKeys.length === 0) {
          let out = `📖 **EDA Tool 文件**\n\n`;
          out += `⚠️ 未找到工具。請指定工具名稱，例如：\n`;
          out += `- \`action=docs question="DC synthesis 範例"\`\n`;
          out += `- \`action=docs question="Innovus placement 指令"\`\n`;
          out += `- \`action=docs question="Yosys overview"\`\n`;
          out += `\n可用工具：${Object.keys(VENDOR_DOCS).join(', ')}\n`;
          return { ok: true, output: out };
        }

        const toolKey = docToolKeys[0];
        const topic = detectDocTopic(searchQuery);
        const result = await fetchDocContent(toolKey, topic);

        if (!result) {
          return { ok: true, output: `📖 未找到 ${toolKey} 的相關文件` };
        }

        let out = `📖 **${result.tool}** 文件`;
        if (topic) out += `（${topic}）`;
        out += '\n\n';

        if (result.type === 'fetched') {
          out += `📄 **來源**：[${result.source}](${result.source})\n\n`;
          out += '```\n' + result.content + '\n```\n';
        } else if (result.type === 'indexed') {
          out += `🏢 **廠商**：${result.vendor}\n\n`;
          for (const ex of result.excerpts) {
            out += `### ${ex.topic}\n`;
            out += ex.content + '\n\n';
          }
          if (result.solvnet) {
            out += `📎 [更多文件](${result.solvnet})\n`;
          }
        } else if (result.type === 'error') {
          out += `⚠️ 爬取失敗：${result.error}\n`;
          out += `📎 [原始文件](${result.source})\n`;
        }

        return { ok: true, output: out };
      }

      default:
        return { ok: false, error: `未知 action: ${action}. 可用: auto, pdk, paper, tool, github, code, all, list-tools, list-pdk, list-conferences, flow, dft, lec, eco, fpga, troubleshoot, docs` };
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
    + '支援 18 種 action：auto（自動判斷）、pdk（PDK/cell library）、paper（學術論文）、tool（EDA 工具）、github（GitHub 專案）、code（程式碼搜尋）、all（綜合）、list-tools、list-pdk、list-conferences、flow、dft、lec、eco、fpga、troubleshoot（Tool 問題診斷含 FAQ+廠商 Q&A）。'
    + '資料來源：GitHub API + OpenAlex + Semantic Scholar。'
    + '內建 55+ EDA 工具索引（含 30+ 商業工具）、10+ PDK 索引、11 個 cell flow stages、10 個 tool FAQ 索引（DC/Innovus/PrimeTime/Calibre/Vivado/VCS/Xcelium/LEC/Formality）、9 大 EDA 會議。',
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
          'troubleshoot', 'docs',
        ],
        description: '查詢動作。auto=自動判斷類型，pdk=PDK/cell library，paper=學術論文，tool=EDA工具，github=GitHub專案，code=程式碼搜尋，all=綜合，list-tools=列出已知工具，list-pdk=列出已知PDK，list-conferences=列出EDA會議，flow=cell flow stages，dft=Design-for-Test，lec=Logic Equivalence Check，eco=Engineering Change Order，fpga=FPGA Design Flow，troubleshoot=Tool 問題診斷（FAQ+廠商Q&A），docs=爬取工具 user guide / 文件',
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
