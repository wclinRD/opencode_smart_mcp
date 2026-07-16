/**
 * EDA 領域縮寫展開 + 模式規則
 * 用於查詢增強：自動展開常見縮寫和詞綴變化
 */

// EDA 領域常見縮寫 → 全名（自動展開）
export const EDA_ABBREVIATIONS = {
  'sta': 'static timing analysis',
  'pnr': 'place and route',
  'drc': 'design rule check',
  'lvs': 'layout vs schematic',
  'erc': 'electrical rule check',
  'dft': 'design for test',
  'bist': 'built-in self test',
  'scan': 'scan chain',
  'atpg': 'automatic test pattern generation',
  'sdf': 'standard delay format',
  'spef': 'standard parasitic exchange format',
  'sdc': 'synopsys design constraints',
  'lef': 'library exchange format',
  'def': 'design exchange format',
  'gdsii': 'graphic data stream',
  'oa': 'openaccess',
  'upf': 'unified power format',
  'cpf': 'common power format',
  'ilp': 'integer linear programming',
  'lp': 'linear programming',
  'dp': 'dynamic programming',
  'fft': 'fast fourier transform',
  'dsp': 'digital signal processing',
  'adc': 'analog to digital converter',
  'dac': 'digital to analog converter',
  'pll': 'phase locked loop',
  'dll': 'delay locked loop',
  'serdes': 'serializer deserializer',
  'phy': 'physical layer',
  'pcie': 'pci express',
  'ddr': 'double data rate',
  'sram': 'static random access memory',
  'dram': 'dynamic random access memory',
  'rom': 'read only memory',
  'otp': 'one time programmable',
  'flash': 'flash memory',
  'rf': 'radio frequency',
  'mmic': 'monolithic microwave ic',
  'asic': 'application specific integrated circuit',
  'fpga': 'field programmable gate array',
  'cpld': 'complex programmable logic device',
  'soc': 'system on chip',
  'noc': 'network on chip',
  'bus': 'bus architecture',
  'apb': 'advanced peripheral bus',
  'ahb': 'advanced high performance bus',
  'axi': 'advanced extensible interface',
  'amba': 'advanced microcontroller bus architecture',
};

// 模式規則：自動展開常見詞綴變化
export const PATTERN_RULES = [
  // mux → multiplexer
  { pattern: /\bmux\b/gi, expand: 'multiplexer' },
  { pattern: /\bdemux\b/gi, expand: 'demultiplexer' },
  // reg → register
  { pattern: /\breg\b/gi, expand: 'register' },
  { pattern: /\bregs\b/gi, expand: 'registers' },
  // flop → flip flop
  { pattern: /\bflop\b/gi, expand: 'flip flop' },
  { pattern: /\bflops\b/gi, expand: 'flip flops' },
  // clk → clock
  { pattern: /\bclk\b/gi, expand: 'clock' },
  // rst → reset
  { pattern: /\brst\b/gi, expand: 'reset' },
  // en → enable
  { pattern: /\ben\b(?!\w)/gi, expand: 'enable' },
  // sel → select
  { pattern: /\bsel\b(?!\w)/gi, expand: 'select' },
  // lat → latch
  { pattern: /\blat\b/gi, expand: 'latch' },
  // dec → decoder
  { pattern: /\bdec\b/gi, expand: 'decoder' },
  // enc → encoder
  { pattern: /\benc\b/gi, expand: 'encoder' },
  // arb → arbiter
  { pattern: /\barb\b/gi, expand: 'arbiter' },
  // ctrl → controller
  { pattern: /\bctrl\b/gi, expand: 'controller' },
  // gen → generator
  { pattern: /\bgen\b/gi, expand: 'generator' },
  // sync → synchronizer
  { pattern: /\bsync\b/gi, expand: 'synchronizer' },
  // async → asynchronous
  { pattern: /\basync\b/gi, expand: 'asynchronous' },
  // comb → combinational
  { pattern: /\bcomb\b/gi, expand: 'combinational' },
  // seq → sequential
  { pattern: /\bseq\b/gi, expand: 'sequential' },
  // buf → buffer
  { pattern: /\bbuf\b/gi, expand: 'buffer' },
  // inv → inverter
  { pattern: /\binv\b/gi, expand: 'inverter' },
  // nand, nor, xor, xnor → 全名
  { pattern: /\bnand\b/gi, expand: 'nand gate' },
  { pattern: /\bnor\b/gi, expand: 'nor gate' },
  { pattern: /\bxor\b/gi, expand: 'xor gate' },
  { pattern: /\bxnor\b/gi, expand: 'xnor gate' },
];
