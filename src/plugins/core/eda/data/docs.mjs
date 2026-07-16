/**
 * EDA 廠商文件 URL 索引
 * 開源工具：GitHub raw URL（可直接爬取）
 * 商業工具：常見 topic 的文件段落 + SolvNet 搜尋 URL
 */
export const VENDOR_DOCS = {
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
      { topic: 'extraction', excerpt: 'STARXT -65 *.gds *.spice tech.tluplus — extraction。SPEF output: *.spef。SDF output: *.sdf。' },
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
      { topic: 'compile', excerpt: 'vlog -sv file.sv — 編譯 SV。vlog +acc — access。vlog -timescale "1ns/1ps" — timeunit。vopt +acc top — 優化。' },
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
