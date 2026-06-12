/**
 * =============================================================================
 * SCRIPT DE DATA SEEDING — Catálogo de Produtos Dinâmico
 * SGBD II | Ano Letivo 2025/2026
 *
 * Estratégia de Geração:
 *   - 100.000 documentos de produtos com atributos realistas por categoria
 *   - Distribuição de categorias ponderada (simula catálogo real de e-commerce)
 *   - Reviews embutidas com Subset Pattern (máx. 10 por produto)
 *   - Desnormalização aplicada: rating_summary, category.breadcrumb, price.discount_pct
 *   - Inserção em lotes (bulk write) de 500 documentos para eficiência de rede
 *
 * Requisitos: Node.js >= 20, @faker-js/faker, mongodb
 * Uso: node seed.js [--total=100000] [--batch=500]
 * =============================================================================
 */

"use strict";

const { MongoClient, Decimal128, ObjectId } = require("mongodb");
const { faker } = require("@faker-js/faker/locale/pt_PT");

// ---------------------------------------------------------------------------
// CONFIGURAÇÃO
// ---------------------------------------------------------------------------
const CONFIG = {
  uri:
    process.env.MONGO_URI ||
    "mongodb://localhost:27017/catalog_db?directConnection=true",
  dbName: "catalog_db",
  collection: "products",
  totalDocs: parseInt(
    process.argv.find((a) => a.startsWith("--total="))?.split("=")[1] ??
      "100000",
  ),
  batchSize: parseInt(
    process.argv.find((a) => a.startsWith("--batch="))?.split("=")[1] ?? "500",
  ),
};

// ---------------------------------------------------------------------------
// TAXONOMIA DE CATEGORIAS
// Estrutura: { id, name, path, breadcrumb, weight }
// weight: probabilidade relativa de um produto pertencer a esta categoria
// (simula distribuição real de catálogos — eletrónica e moda dominam)
// ---------------------------------------------------------------------------
const CATEGORIES = [
  // ── ELETRÓNICA ────────────────────────────────────────────────────────────
  {
    id: "smartphones-android",
    name: "Smartphones Android",
    path: "/eletronicos/smartphones/android",
    weight: 12,
    breadcrumb: [
      { id: "eletronicos", name: "Eletrónica", slug: "eletronica" },
      { id: "smartphones", name: "Smartphones", slug: "smartphones" },
      {
        id: "smartphones-android",
        name: "Android",
        slug: "smartphones-android",
      },
    ],
  },
  {
    id: "smartphones-ios",
    name: "Smartphones iOS",
    path: "/eletronicos/smartphones/ios",
    weight: 6,
    breadcrumb: [
      { id: "eletronicos", name: "Eletrónica", slug: "eletronica" },
      { id: "smartphones", name: "Smartphones", slug: "smartphones" },
      { id: "smartphones-ios", name: "iOS (iPhone)", slug: "smartphones-ios" },
    ],
  },
  {
    id: "laptops-gaming",
    name: "Laptops Gaming",
    path: "/eletronicos/computadores/laptops/gaming",
    weight: 5,
    breadcrumb: [
      { id: "eletronicos", name: "Eletrónica", slug: "eletronica" },
      { id: "computadores", name: "Computadores", slug: "computadores" },
      { id: "laptops", name: "Laptops", slug: "laptops" },
      { id: "laptops-gaming", name: "Gaming", slug: "laptops-gaming" },
    ],
  },
  {
    id: "laptops-trabalho",
    name: "Laptops Trabalho/Estudo",
    path: "/eletronicos/computadores/laptops/trabalho",
    weight: 7,
    breadcrumb: [
      { id: "eletronicos", name: "Eletrónica", slug: "eletronica" },
      { id: "computadores", name: "Computadores", slug: "computadores" },
      { id: "laptops", name: "Laptops", slug: "laptops" },
      {
        id: "laptops-trabalho",
        name: "Trabalho/Estudo",
        slug: "laptops-trabalho",
      },
    ],
  },
  {
    id: "tvs",
    name: "Televisores",
    path: "/eletronicos/televisores",
    weight: 6,
    breadcrumb: [
      { id: "eletronicos", name: "Eletrónica", slug: "eletronica" },
      { id: "tvs", name: "Televisores", slug: "televisores" },
    ],
  },
  {
    id: "audiofones",
    name: "Auscultadores e Auriculares",
    path: "/eletronicos/audio/audiofones",
    weight: 8,
    breadcrumb: [
      { id: "eletronicos", name: "Eletrónica", slug: "eletronica" },
      { id: "audio", name: "Áudio", slug: "audio" },
      {
        id: "audiofones",
        name: "Auscultadores/Auriculares",
        slug: "audiofones",
      },
    ],
  },
  {
    id: "frigorifico",
    name: "Frigoríficos",
    path: "/eletrodomesticos/frigorifico",
    weight: 4,
    breadcrumb: [
      {
        id: "eletrodomesticos",
        name: "Eletrodomésticos",
        slug: "eletrodomesticos",
      },
      { id: "frigorifico", name: "Frigoríficos", slug: "frigorifico" },
    ],
  },
  {
    id: "maquina-lavar",
    name: "Máquinas de Lavar",
    path: "/eletrodomesticos/maquina-lavar",
    weight: 3,
    breadcrumb: [
      {
        id: "eletrodomesticos",
        name: "Eletrodomésticos",
        slug: "eletrodomesticos",
      },
      { id: "maquina-lavar", name: "Máquinas de Lavar", slug: "maquina-lavar" },
    ],
  },
  // ── MODA ─────────────────────────────────────────────────────────────────
  {
    id: "calcado-desportivo",
    name: "Calçado Desportivo",
    path: "/moda/calcado/desportivo",
    weight: 9,
    breadcrumb: [
      { id: "moda", name: "Moda", slug: "moda" },
      { id: "calcado", name: "Calçado", slug: "calcado" },
      {
        id: "calcado-desportivo",
        name: "Desportivo",
        slug: "calcado-desportivo",
      },
    ],
  },
  {
    id: "vestuario-masculino",
    name: "Vestuário Masculino",
    path: "/moda/vestuario/masculino",
    weight: 10,
    breadcrumb: [
      { id: "moda", name: "Moda", slug: "moda" },
      { id: "vestuario", name: "Vestuário", slug: "vestuario" },
      {
        id: "vestuario-masculino",
        name: "Masculino",
        slug: "vestuario-masculino",
      },
    ],
  },
  {
    id: "vestuario-feminino",
    name: "Vestuário Feminino",
    path: "/moda/vestuario/feminino",
    weight: 11,
    breadcrumb: [
      { id: "moda", name: "Moda", slug: "moda" },
      { id: "vestuario", name: "Vestuário", slug: "vestuario" },
      {
        id: "vestuario-feminino",
        name: "Feminino",
        slug: "vestuario-feminino",
      },
    ],
  },
  // ── DESPORTO ──────────────────────────────────────────────────────────────
  {
    id: "fitness-musculacao",
    name: "Fitness e Musculação",
    path: "/desporto/fitness/musculacao",
    weight: 6,
    breadcrumb: [
      { id: "desporto", name: "Desporto", slug: "desporto" },
      { id: "fitness", name: "Fitness", slug: "fitness" },
      {
        id: "fitness-musculacao",
        name: "Musculação",
        slug: "fitness-musculacao",
      },
    ],
  },
  {
    id: "ciclismo",
    name: "Ciclismo",
    path: "/desporto/ciclismo",
    weight: 4,
    breadcrumb: [
      { id: "desporto", name: "Desporto", slug: "desporto" },
      { id: "ciclismo", name: "Ciclismo", slug: "ciclismo" },
    ],
  },
  // ── CASA & JARDIM ─────────────────────────────────────────────────────────
  {
    id: "mobiliario-sala",
    name: "Mobiliário de Sala",
    path: "/casa/mobiliario/sala",
    weight: 5,
    breadcrumb: [
      { id: "casa", name: "Casa & Jardim", slug: "casa" },
      { id: "mobiliario", name: "Mobiliário", slug: "mobiliario" },
      { id: "mobiliario-sala", name: "Sala", slug: "mobiliario-sala" },
    ],
  },
  {
    id: "iluminacao",
    name: "Iluminação",
    path: "/casa/iluminacao",
    weight: 4,
    breadcrumb: [
      { id: "casa", name: "Casa & Jardim", slug: "casa" },
      { id: "iluminacao", name: "Iluminação", slug: "iluminacao" },
    ],
  },
];

// ---------------------------------------------------------------------------
// GERADORES DE ATRIBUTOS POR CATEGORIA
// Cada função retorna um subdocumento de atributos específico da categoria,
// demonstrando o poder do schema flexível do MongoDB (vs. EAV relacional)
// ---------------------------------------------------------------------------

const ATTRIBUTE_GENERATORS = {
  "smartphones-android": () => ({
    screen_size_inches: faker.number.float({
      min: 5.5,
      max: 7.2,
      fractionDigits: 1,
    }),
    screen_technology: faker.helpers.arrayElement([
      "AMOLED",
      "Dynamic AMOLED 2X",
      "OLED",
      "IPS LCD",
      "Super AMOLED",
    ]),
    screen_refresh_rate_hz: faker.helpers.arrayElement([60, 90, 120, 144, 165]),
    processor: faker.helpers.arrayElement([
      "Snapdragon 8 Gen 3",
      "Snapdragon 8 Gen 2",
      "Dimensity 9300",
      "Exynos 2400",
      "Kirin 9000S",
    ]),
    ram_gb: faker.helpers.arrayElement([6, 8, 12, 16, 24]),
    storage_gb: faker.helpers.arrayElement([128, 256, 512, 1024]),
    battery_mah: faker.number.int({ min: 4000, max: 6000 }),
    fast_charge_watts: faker.helpers.arrayElement([25, 45, 65, 100, 120]),
    os: faker.helpers.arrayElement(["Android 14", "Android 13", "Android 15"]),
    "5g_capable": faker.datatype.boolean({ probability: 0.75 }),
    camera_main_mp: faker.helpers.arrayElement([50, 64, 108, 200]),
    ip_rating: faker.helpers.arrayElement(["IP67", "IP68", "IP65", null]),
    nfc: faker.datatype.boolean({ probability: 0.8 }),
    colors_available: faker.helpers.arrayElements(
      [
        "Preto Titânio",
        "Branco Areia",
        "Violeta",
        "Bege",
        "Verde",
        "Azul Marinho",
      ],
      { min: 2, max: 5 },
    ),
    weight_grams: faker.number.int({ min: 170, max: 230 }),
  }),

  "smartphones-ios": () => ({
    screen_size_inches: faker.helpers.arrayElement([6.1, 6.7, 6.9]),
    screen_technology: "Super Retina XDR OLED",
    screen_refresh_rate_hz: faker.helpers.arrayElement([60, 120]),
    processor: faker.helpers.arrayElement([
      "Apple A17 Pro",
      "Apple A16 Bionic",
      "Apple A18 Pro",
    ]),
    ram_gb: faker.helpers.arrayElement([6, 8]),
    storage_gb: faker.helpers.arrayElement([128, 256, 512, 1024]),
    battery_mah: faker.number.int({ min: 3200, max: 4400 }),
    fast_charge_watts: faker.helpers.arrayElement([20, 27]),
    os: faker.helpers.arrayElement(["iOS 17", "iOS 18"]),
    "5g_capable": true,
    camera_main_mp: faker.helpers.arrayElement([48, 48]),
    ip_rating: "IP68",
    magsafe_compatible: true,
    face_id: true,
    colors_available: faker.helpers.arrayElements(
      ["Preto", "Branco", "Azul", "Rosa", "Natural Titânio", "Azul Titânio"],
      { min: 2, max: 4 },
    ),
    weight_grams: faker.number.int({ min: 170, max: 221 }),
  }),

  "laptops-gaming": () => ({
    processor: faker.helpers.arrayElement([
      "Intel Core i7-13700H",
      "Intel Core i9-14900HX",
      "AMD Ryzen 9 7945HX",
      "Intel Core i7-14700H",
    ]),
    ram_gb: faker.helpers.arrayElement([16, 32, 64]),
    ram_type: faker.helpers.arrayElement(["DDR5-4800", "DDR5-5600", "LPDDR5"]),
    storage_gb: faker.helpers.arrayElement([512, 1024, 2048]),
    storage_type: "NVMe PCIe 4.0",
    gpu: faker.helpers.arrayElement([
      "NVIDIA RTX 4060",
      "NVIDIA RTX 4070",
      "NVIDIA RTX 4080",
      "NVIDIA RTX 4090",
      "AMD RX 7600M",
    ]),
    vram_gb: faker.helpers.arrayElement([8, 12, 16]),
    display_inches: faker.helpers.arrayElement([15.6, 16.0, 17.3]),
    display_resolution: faker.helpers.arrayElement([
      "1920x1080 FHD",
      "2560x1440 QHD",
      "3840x2160 4K",
    ]),
    display_refresh_hz: faker.helpers.arrayElement([144, 165, 240, 360]),
    battery_wh: faker.number.int({ min: 72, max: 99 }),
    weight_kg: faker.number.float({ min: 2.0, max: 3.5, fractionDigits: 1 }),
    rgb_keyboard: true,
    os: faker.helpers.arrayElement([
      "Windows 11 Home",
      "Windows 11 Pro",
      "Sem SO",
    ]),
    cooling_system: faker.helpers.arrayElement([
      "Dual Fan",
      "Triple Fan",
      "Vapor Chamber",
    ]),
  }),

  "laptops-trabalho": () => ({
    processor: faker.helpers.arrayElement([
      "Intel Core Ultra 7 155H",
      "Apple M3",
      "Apple M3 Pro",
      "AMD Ryzen 7 8845HS",
      "Intel Core i5-1335U",
    ]),
    ram_gb: faker.helpers.arrayElement([8, 16, 32]),
    storage_gb: faker.helpers.arrayElement([256, 512, 1024]),
    display_inches: faker.helpers.arrayElement([13.3, 14.0, 15.6]),
    display_resolution: faker.helpers.arrayElement([
      "1920x1080",
      "2560x1600",
      "2880x1864",
    ]),
    battery_wh: faker.number.int({ min: 50, max: 100 }),
    battery_life_hours: faker.number.int({ min: 8, max: 22 }),
    weight_kg: faker.number.float({ min: 0.9, max: 1.8, fractionDigits: 2 }),
    os: faker.helpers.arrayElement([
      "Windows 11 Pro",
      "macOS Sonoma",
      "Chrome OS",
      "Ubuntu",
    ]),
    fingerprint_reader: faker.datatype.boolean({ probability: 0.7 }),
    backlit_keyboard: faker.datatype.boolean({ probability: 0.9 }),
    thunderbolt_ports: faker.helpers.arrayElement([0, 1, 2, 4]),
    military_grade_certified: faker.datatype.boolean({ probability: 0.3 }),
  }),

  tvs: () => ({
    screen_size_inches: faker.helpers.arrayElement([
      43, 50, 55, 65, 75, 85, 98,
    ]),
    panel_technology: faker.helpers.arrayElement([
      "LED",
      "QLED",
      "OLED",
      "OLED evo",
      "Mini LED",
      "Neo QLED",
    ]),
    resolution: faker.helpers.arrayElement([
      "Full HD 1080p",
      "4K UHD",
      "8K UHD",
    ]),
    refresh_rate_hz: faker.helpers.arrayElement([50, 60, 100, 120, 144]),
    smart_tv: true,
    os: faker.helpers.arrayElement([
      "Tizen",
      "WebOS",
      "Android TV",
      "Google TV",
      "Fire TV",
    ]),
    hdr_formats: faker.helpers.arrayElements(
      ["HDR10", "HDR10+", "Dolby Vision", "HLG", "HDMI 2.1"],
      { min: 1, max: 4 },
    ),
    hdmi_ports: faker.helpers.arrayElement([2, 3, 4]),
    usb_ports: faker.helpers.arrayElement([1, 2, 3]),
    wifi: faker.helpers.arrayElement(["Wi-Fi 5", "Wi-Fi 6", "Wi-Fi 6E"]),
    voice_assistant: faker.helpers.arrayElements(
      ["Alexa", "Google Assistant", "Bixby"],
      { min: 1, max: 2 },
    ),
    energy_class: faker.helpers.arrayElement(["B", "C", "D", "E", "F"]),
  }),

  audiofones: () => ({
    type: faker.helpers.arrayElement([
      "Over-ear",
      "On-ear",
      "In-ear (True Wireless)",
      "In-ear (com fio)",
    ]),
    driver_mm: faker.helpers.arrayElement([8, 10, 12, 40, 45, 50]),
    anc: faker.datatype.boolean({ probability: 0.6 }),
    transparency_mode: faker.datatype.boolean({ probability: 0.4 }),
    bluetooth_version: faker.helpers.arrayElement(["5.0", "5.1", "5.2", "5.3"]),
    battery_hours: faker.number.int({ min: 6, max: 40 }),
    charging_case_hours: faker.number.int({ min: 0, max: 36 }),
    fast_charge_min_for_h: faker.helpers.arrayElement([null, 10, 15]),
    water_resistance: faker.helpers.arrayElement([
      "Nenhuma",
      "IPX4",
      "IPX5",
      "IP55",
      "IP57",
    ]),
    codecs: faker.helpers.arrayElements(
      ["SBC", "AAC", "aptX", "aptX HD", "LDAC", "LC3"],
      { min: 1, max: 4 },
    ),
    microphone: faker.datatype.boolean({ probability: 0.9 }),
    foldable: faker.datatype.boolean({ probability: 0.3 }),
    colors_available: faker.helpers.arrayElements(
      ["Preto", "Branco", "Bege", "Azul Meia-noite", "Verde"],
      { min: 1, max: 4 },
    ),
  }),

  frigorifico: () => ({
    capacity_liters_total: faker.number.int({ min: 200, max: 600 }),
    capacity_liters_fridge: faker.number.int({ min: 150, max: 400 }),
    capacity_liters_freezer: faker.number.int({ min: 50, max: 200 }),
    doors: faker.helpers.arrayElement([1, 2, 3, 4]),
    no_frost: faker.datatype.boolean({ probability: 0.7 }),
    energy_class: faker.helpers.arrayElement([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
    ]),
    annual_consumption_kwh: faker.number.int({ min: 90, max: 450 }),
    color: faker.helpers.arrayElement(["Branco", "Preto", "Inox", "Cinzento"]),
    dimensions_cm: {
      height: faker.number.int({ min: 85, max: 200 }),
      width: faker.number.int({ min: 50, max: 90 }),
      depth: faker.number.int({ min: 55, max: 75 }),
    },
    noise_db: faker.number.int({ min: 34, max: 45 }),
    ice_maker: faker.datatype.boolean({ probability: 0.2 }),
    water_dispenser: faker.datatype.boolean({ probability: 0.15 }),
  }),

  "maquina-lavar": () => ({
    type: faker.helpers.arrayElement(["Carga Frontal", "Carga Superior"]),
    capacity_kg: faker.helpers.arrayElement([7, 8, 9, 10, 11, 12, 14]),
    spin_speed_rpm: faker.helpers.arrayElement([1000, 1200, 1400, 1600]),
    energy_class: faker.helpers.arrayElement(["A", "B", "C", "D"]),
    annual_consumption_kwh: faker.number.int({ min: 50, max: 200 }),
    annual_water_liters: faker.number.int({ min: 6000, max: 15000 }),
    programs_count: faker.number.int({ min: 8, max: 20 }),
    quick_wash_min: faker.helpers.arrayElement([15, 30, 45]),
    steam_function: faker.datatype.boolean({ probability: 0.4 }),
    wifi_connected: faker.datatype.boolean({ probability: 0.35 }),
    noise_washing_db: faker.number.int({ min: 45, max: 65 }),
    noise_spinning_db: faker.number.int({ min: 68, max: 82 }),
    color: faker.helpers.arrayElement(["Branco", "Preto", "Prateado"]),
  }),

  "calcado-desportivo": () => ({
    sport: faker.helpers.arrayElements(
      ["Running", "Treino", "Basketball", "Futebol", "Tennis", "Caminhada"],
      { min: 1, max: 3 },
    ),
    upper_material: faker.helpers.arrayElement([
      "Mesh respirável",
      "Knit",
      "Couro sintético",
      "Flyknit",
    ]),
    sole_material: faker.helpers.arrayElement([
      "Borracha",
      "EVA",
      "PU",
      "Carbon",
    ]),
    sizes_eu: faker.helpers.arrayElements(
      [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47],
      { min: 5, max: 10 },
    ),
    gender: faker.helpers.arrayElement(["Masculino", "Feminino", "Unissex"]),
    drop_mm: faker.number.int({ min: 0, max: 12 }),
    weight_grams: faker.number.int({ min: 180, max: 400 }),
    waterproof: faker.datatype.boolean({ probability: 0.3 }),
    colors_available: faker.helpers.arrayElements(
      [
        "Preto/Branco",
        "Branco",
        "Cinzento",
        "Azul Royal",
        "Vermelho",
        "Laranja",
      ],
      { min: 2, max: 5 },
    ),
    sustainable_materials: faker.datatype.boolean({ probability: 0.3 }),
  }),

  "vestuario-masculino": () => ({
    type: faker.helpers.arrayElement([
      "T-shirt",
      "Polo",
      "Camisa",
      "Calças",
      "Calções",
      "Hoodie",
      "Sweatshirt",
      "Casaco",
    ]),
    material: faker.helpers.arrayElement([
      "100% Algodão",
      "Algodão/Poliéster 80/20",
      "Linho",
      "Lã merino",
      "Fleece",
      "Denim",
    ]),
    fit: faker.helpers.arrayElement([
      "Slim Fit",
      "Regular Fit",
      "Relaxed Fit",
      "Oversized",
    ]),
    sizes_available: faker.helpers.arrayElements(
      ["XS", "S", "M", "L", "XL", "XXL", "XXXL"],
      { min: 4, max: 7 },
    ),
    care_instructions: faker.helpers.arrayElements(
      [
        "Lavar a 30°C",
        "Não usar secador",
        "Lavar a seco",
        "Passar a ferro baixa temperatura",
      ],
      { min: 2, max: 3 },
    ),
    season: faker.helpers.arrayElements(
      ["Verão", "Inverno", "Primavera", "Outono"],
      { min: 1, max: 3 },
    ),
    sustainable: faker.datatype.boolean({ probability: 0.25 }),
    colors_available: faker.helpers.arrayElements(
      [
        "Branco",
        "Preto",
        "Cinzento",
        "Azul marinho",
        "Verde oliva",
        "Bordeaux",
        "Bege",
      ],
      { min: 2, max: 6 },
    ),
  }),

  "vestuario-feminino": () => ({
    type: faker.helpers.arrayElement([
      "Vestido",
      "Blusa",
      "Top",
      "Calças",
      "Saia",
      "Casaco",
      "Cardigan",
      "Jumpsuit",
    ]),
    material: faker.helpers.arrayElement([
      "Seda",
      "Algodão orgânico",
      "Viscose",
      "Linho",
      "Lã",
      "Jersey",
    ]),
    fit: faker.helpers.arrayElement([
      "Justo",
      "Regular",
      "Largo",
      "A-line",
      "Wrap",
    ]),
    sizes_available: faker.helpers.arrayElements(
      ["34", "36", "38", "40", "42", "44", "46"],
      { min: 4, max: 7 },
    ),
    care_instructions: faker.helpers.arrayElements(
      ["Lavar à mão", "Lavar a 30°C", "Limpeza a seco", "Não torcer"],
      { min: 1, max: 3 },
    ),
    season: faker.helpers.arrayElements(
      ["Verão", "Inverno", "Primavera", "Outono"],
      { min: 1, max: 3 },
    ),
    sustainable: faker.datatype.boolean({ probability: 0.3 }),
    colors_available: faker.helpers.arrayElements(
      [
        "Branco",
        "Preto",
        "Rosa empoado",
        "Terracota",
        "Verde salva",
        "Camel",
        "Lilás",
      ],
      { min: 2, max: 6 },
    ),
  }),

  "fitness-musculacao": () => ({
    type: faker.helpers.arrayElement([
      "Halteres",
      "Barra",
      "Discos",
      "Kettlebell",
      "Banco",
      "Rack",
      "Cabo",
      "Tapete",
      "Elástico",
    ]),
    material: faker.helpers.arrayElement([
      "Ferro fundido",
      "Aço",
      "Borracha vulcanizada",
      "Vinil",
      "Polipropileno",
    ]),
    weight_kg: faker.number.float({ min: 1, max: 150, fractionDigits: 1 }),
    adjustable: faker.datatype.boolean({ probability: 0.4 }),
    max_load_kg: faker.number.int({ min: 50, max: 500 }),
    set_included: faker.datatype.boolean({ probability: 0.3 }),
    color: faker.helpers.arrayElement([
      "Preto",
      "Prateado",
      "Cromado",
      "Vermelho",
      "Azul",
    ]),
  }),

  ciclismo: () => ({
    type: faker.helpers.arrayElement([
      "Bicicleta Estrada",
      "Bicicleta MTB",
      "Bicicleta Urbana",
      "E-Bike",
      "Bicicleta Criança",
    ]),
    frame_material: faker.helpers.arrayElement([
      "Alumínio",
      "Carbono",
      "Aço",
      "Titânio",
    ]),
    gears: faker.helpers.arrayElement([1, 7, 8, 10, 11, 12, 22]),
    wheel_size_inches: faker.helpers.arrayElement([20, 24, 26, 27.5, 28, 29]),
    brakes: faker.helpers.arrayElement([
      "Travões de Disco Hidráulico",
      "Travões de Disco Mecânico",
      "V-Brake",
    ]),
    suspension: faker.helpers.arrayElement([
      "Rígida",
      "Suspensão Frontal",
      "Suspensão Total",
    ]),
    electric: faker.datatype.boolean({ probability: 0.2 }),
    battery_km_range: faker.helpers.arrayElement([null, 60, 80, 100, 120]),
    max_rider_weight_kg: faker.helpers.arrayElement([100, 110, 120, 130]),
    weight_kg: faker.number.float({ min: 7, max: 25, fractionDigits: 1 }),
    color: faker.helpers.arrayElements(
      ["Preto", "Branco", "Vermelho", "Azul", "Verde", "Laranja"],
      { min: 1, max: 3 },
    ),
  }),

  "mobiliario-sala": () => ({
    type: faker.helpers.arrayElement([
      "Sofá",
      "Mesa de Centro",
      "Estante",
      "Móvel TV",
      "Cadeirão",
      "Pouf",
      "Aparador",
    ]),
    material: faker.helpers.arrayElement([
      "Madeira maciça",
      "MDF lacado",
      "Nogueira",
      "Carvalho",
      "Tecido",
      "Couro",
      "Veludo",
    ]),
    dimensions_cm: {
      height: faker.number.int({ min: 35, max: 220 }),
      width: faker.number.int({ min: 40, max: 300 }),
      depth: faker.number.int({ min: 30, max: 100 }),
    },
    color: faker.helpers.arrayElements(
      ["Branco", "Preto", "Natural", "Cinzento", "Nogueira", "Verde Musgo"],
      { min: 1, max: 3 },
    ),
    max_load_kg: faker.number.int({ min: 20, max: 300 }),
    assembly_required: faker.datatype.boolean({ probability: 0.7 }),
    number_of_seats: faker.helpers.arrayElement([null, 2, 3, 4]),
    storage: faker.datatype.boolean({ probability: 0.4 }),
    style: faker.helpers.arrayElement([
      "Moderno",
      "Escandinavo",
      "Industrial",
      "Clássico",
      "Minimalista",
      "Boho",
    ]),
  }),

  iluminacao: () => ({
    type: faker.helpers.arrayElement([
      "Candeeiro de Teto",
      "Candeeiro de Pé",
      "Candeeiro de Mesa",
      "Aplique",
      "Fita LED",
      "Projetor",
    ]),
    bulb_type: faker.helpers.arrayElement([
      "LED integrado",
      "E27",
      "E14",
      "GU10",
      "GU5.3",
    ]),
    lumens: faker.number.int({ min: 200, max: 5000 }),
    watts: faker.number.float({ min: 3, max: 60, fractionDigits: 1 }),
    color_temperature_k: faker.helpers.arrayElement([
      2700, 3000, 4000, 5000, 6500,
    ]),
    dimmable: faker.datatype.boolean({ probability: 0.5 }),
    smart_compatible: faker.datatype.boolean({ probability: 0.35 }),
    ip_rating: faker.helpers.arrayElement(["IP20", "IP44", "IP65", "IP67"]),
    material: faker.helpers.arrayElement([
      "Metal",
      "Vidro",
      "Tecido",
      "Madeira",
      "Acrílico",
    ]),
    color: faker.helpers.arrayElement([
      "Dourado",
      "Preto mate",
      "Branco",
      "Cromado",
      "Bronze",
      "Cobre",
    ]),
  }),
};

// ---------------------------------------------------------------------------
// FUNÇÕES AUXILIARES
// ---------------------------------------------------------------------------

/** Seleciona uma categoria aleatória com base nos pesos definidos */
function weightedRandomCategory() {
  const totalWeight = CATEGORIES.reduce((sum, c) => sum + c.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const cat of CATEGORIES) {
    rand -= cat.weight;
    if (rand <= 0) return cat;
  }
  return CATEGORIES[CATEGORIES.length - 1];
}

/** Gera um subdocumento de review realista */
function generateReview() {
  const rating = faker.helpers.weightedArrayElement([
    { weight: 5, value: 5 },
    { weight: 4, value: 4 },
    { weight: 2, value: 3 },
    { weight: 1, value: 2 },
    { weight: 1, value: 1 },
  ]);

  return {
    review_id: new ObjectId(),
    user_id: `user_${faker.string.alphanumeric(10)}`,
    username_snapshot: faker.internet.username(),
    rating,
    title: faker.helpers.arrayElement([
      "Produto excelente, recomendo!",
      "Boa relação qualidade-preço",
      "Dentro das expectativas",
      "Poderia ser melhor...",
      "Não gostei, devolvi.",
      "Surpreendentemente bom!",
      "Exatamente como descrito",
      "Entrega rápida, produto ok",
      "Qualidade premium, vale o preço",
      "Comprei para oferta, adoraram!",
    ]),
    body: faker.lorem.sentences({ min: 1, max: 4 }),
    helpful_votes: faker.number.int({ min: 0, max: 450 }),
    verified_purchase: faker.datatype.boolean({ probability: 0.72 }),
    created_at: faker.date.between({ from: "2022-01-01", to: new Date() }),
  };
}

/** Calcula o rating_summary a partir do array de reviews (Computed Pattern) */
function computeRatingSummary(reviews) {
  if (reviews.length === 0) {
    return {
      average: 0,
      count: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };
  }
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  for (const r of reviews) {
    dist[r.rating]++;
    total += r.rating;
  }
  return {
    average: Math.round((total / reviews.length) * 100) / 100,
    count: reviews.length,
    distribution: dist,
  };
}

/** Gera imagens simuladas para o produto */
function generateImages(productName) {
  const count = faker.number.int({ min: 1, max: 6 });
  return Array.from({ length: count }, (_, i) => ({
    url: `https://cdn.ecommerce-catalog.ao/products/${faker.string.uuid()}.webp`,
    alt_text: `${productName} - imagem ${i + 1}`,
    is_primary: i === 0,
    width_px: faker.helpers.arrayElement([800, 1200, 1600, 2000]),
    height_px: faker.helpers.arrayElement([800, 1200, 1600, 2000]),
  }));
}

/** Gera o subdocumento de preço com possibilidade de desconto */
function generatePrice(category) {
  // Intervalos de preço por família de categoria
  const priceRanges = {
    "/eletronicos": { min: 50, max: 4500 },
    "/eletrodomesticos": { min: 200, max: 3000 },
    "/moda": { min: 15, max: 600 },
    "/desporto": { min: 10, max: 5000 },
    "/casa": { min: 25, max: 3500 },
  };

  const family =
    Object.keys(priceRanges).find((k) => category.path.startsWith(k)) ||
    "/moda";
  const range = priceRanges[family];
  const originalRaw = faker.number.float({
    min: range.min,
    max: range.max,
    fractionDigits: 2,
  });

  const hasDiscount = faker.datatype.boolean({ probability: 0.3 });
  const discountPct = hasDiscount
    ? faker.helpers.arrayElement([5, 10, 15, 20, 25, 30, 40, 50])
    : 0;
  const currentRaw = hasDiscount
    ? +(originalRaw * (1 - discountPct / 100)).toFixed(2)
    : originalRaw;

  return {
    current: Decimal128.fromString(currentRaw.toFixed(2)),
    original: hasDiscount
      ? Decimal128.fromString(originalRaw.toFixed(2))
      : undefined,
    currency: "USD",
    discount_pct: hasDiscount ? discountPct : undefined,
  };
}

/** Gera a localização GeoJSON do armazém (Angola — Luanda e outras províncias) */
function generateWarehouseLocation() {
  // Coordenadas de armazéns fictícios em Angola
  const warehouses = [
    { id: "WH-LUA-01", coords: [13.2343, -8.8368], name: "Luanda - Belas" },
    { id: "WH-LUA-02", coords: [13.3, -8.75], name: "Luanda - Viana" },
    { id: "WH-BEN-01", coords: [13.2444, -12.5763], name: "Benguela - Sede" },
    { id: "WH-HUA-01", coords: [15.7392, -12.775], name: "Huambo - Sede" },
    { id: "WH-LUB-01", coords: [21.7167, -11.7833], name: "Lubango - Sede" },
    { id: "WH-CAB-01", coords: [12.193, -5.55], name: "Cabinda - Sede" },
    { id: "WH-MAL-01", coords: [16.35, -9.5333], name: "Malanje - Sede" },
  ];

  const w = faker.helpers.arrayElement(warehouses);
  // Adiciona variação aleatória de ±0.05 graus (~5km) para simular endereços distintos
  return {
    warehouse_id: w.id,
    warehouse_location: {
      type: "Point",
      coordinates: [
        +(
          w.coords[0] +
          faker.number.float({ min: -0.05, max: 0.05, fractionDigits: 4 })
        ).toFixed(4),
        +(
          w.coords[1] +
          faker.number.float({ min: -0.05, max: 0.05, fractionDigits: 4 })
        ).toFixed(4),
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// GERADOR PRINCIPAL DE DOCUMENTOS
// ---------------------------------------------------------------------------

const skuSet = new Set(); // Garante unicidade de SKUs em memória

function generateProduct() {
  const category = weightedRandomCategory();
  const attrGen = ATTRIBUTE_GENERATORS[category.id] || (() => ({}));
  const attrs = attrGen();

  // Gerar nome realista baseado na categoria
  const brandName = faker.helpers.arrayElement([
    "Samsung",
    "Sony",
    "Apple",
    "LG",
    "Xiaomi",
    "Philips",
    "Bosch",
    "Nike",
    "Adidas",
    "Puma",
    "IKEA",
    "Huawei",
    "Lenovo",
    "Dell",
    "HP",
    "Asus",
    "Acer",
    "OnePlus",
    "Dyson",
    "Bose",
    "JBL",
    "Anker",
    "Garmin",
    "Canyon",
    "Trek",
    "Continental",
    "Miele",
    "Electrolux",
    "Whirlpool",
  ]);
  const productLine = faker.commerce.productAdjective();
  const productName = `${brandName} ${productLine} ${faker.commerce.productName()}`;

  // Gerar SKU único
  let sku;
  const prefix = category.path
    .replace(/\//g, "")
    .substring(0, 4)
    .toUpperCase()
    .padEnd(4, "X");
  do {
    sku = `${prefix}-${faker.string.numeric(9)}`;
  } while (skuSet.has(sku));
  skuSet.add(sku);

  const slug = `${productName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}-${faker.string.alphanumeric(6).toLowerCase()}`;

  const price = generatePrice(category);
  const warehouseInfo = generateWarehouseLocation();
  const reviewCount = faker.number.int({ min: 0, max: 10 });
  const reviews = Array.from({ length: reviewCount }, generateReview).sort(
    (a, b) => b.created_at - a.created_at,
  );
  const ratingSummary = computeRatingSummary(reviews);

  const statusWeights = [
    { weight: 80, value: "active" },
    { weight: 8, value: "inactive" },
    { weight: 5, value: "draft" },
    { weight: 4, value: "out_of_stock" },
    { weight: 3, value: "discontinued" },
  ];

  const quantity = faker.number.int({ min: 0, max: 5000 });
  const reserved = faker.number.int({ min: 0, max: Math.min(quantity, 200) });
  const lowStockThreshold = faker.datatype.boolean({ probability: 0.6 })
    ? faker.number.int({ min: 5, max: 50 })
    : undefined;

  const now = new Date();
  const createdAt = faker.date.between({ from: "2020-01-01", to: now });

  return {
    sku,
    name: productName,
    slug,
    description:
      faker.commerce.productDescription() + " " + faker.lorem.sentences(2),
    brand: brandName,
    price,
    category: {
      id: category.id,
      name: category.name,
      path: category.path,
      breadcrumb: category.breadcrumb,
    },
    stock: {
      quantity,
      reserved,
      low_stock_threshold: lowStockThreshold,
      ...warehouseInfo,
    },
    status: faker.helpers.weightedArrayElement(statusWeights),
    attributes: attrs,
    images: generateImages(productName),
    tags: faker.helpers.arrayElements(
      [
        brandName.toLowerCase(),
        category.name.toLowerCase(),
        "promoção",
        "novo",
        "bestseller",
        "oferta",
        "desconto",
        "importado",
        "garantia-oficial",
        "envio-rápido",
        ...Object.keys(attrs).slice(0, 3),
      ],
      { min: 3, max: 8 },
    ),
    reviews,
    rating_summary: {
      average: ratingSummary.average,
      count: ratingSummary.count,
      distribution: ratingSummary.distribution,
    },
    seo: {
      meta_title: `${productName} | Melhor Preço | E-commerce AO`,
      meta_description: `Compre ${productName} ao melhor preço em Angola. ${faker.lorem.sentence()}`,
      canonical_url: `https://www.ecommerce-catalog.ao/p/${slug}`,
    },
    created_at: createdAt,
    updated_at: faker.date.between({ from: createdAt, to: now }),
  };
}

// ---------------------------------------------------------------------------
// FUNÇÃO DE CRIAÇÃO DE ÍNDICES
// (executada antes do seeding para garantir performance nas inserções)
// ---------------------------------------------------------------------------

async function createIndexes(collection) {
  console.log("\n📐 A criar índices otimizados...");

  const indexes = [
    // Índice único para SKU — O(log n) lookup, garante integridade
    { spec: { sku: 1 }, options: { unique: true, name: "sku_unique" } },
    // Índice único para slug — suporte a routing URLs
    { spec: { slug: 1 }, options: { unique: true, name: "slug_unique" } },
    // Índice composto para QA-01 e QA-02 — filtros de catálogo
    {
      spec: { status: 1, "category.path": 1, "price.current": 1 },
      options: { name: "catalog_browse_compound" },
    },
    // Índice composto para filtros de stock (QA-02)
    {
      spec: { status: 1, "stock.quantity": 1 },
      options: { name: "stock_filter" },
    },
    // Índice de texto composto para QA-01 (full-text search)
    {
      spec: { name: "text", description: "text", tags: "text" },
      options: {
        weights: { name: 10, tags: 5, description: 2 },
        name: "product_text_search",
        default_language: "portuguese",
      },
    },
    // Índice 2dsphere para QA-05 (queries geoespaciais)
    {
      spec: { "stock.warehouse_location": "2dsphere" },
      options: { name: "warehouse_geo_2dsphere" },
    },
    // Índice para filtragem por marca (pesquisa facetada)
    { spec: { brand: 1, status: 1 }, options: { name: "brand_status" } },
    // Índice para ordenação por rating (listagem "Mais Avaliados")
    {
      spec: { "rating_summary.average": -1 },
      options: { name: "rating_avg_desc" },
    },
    // Índice para queries temporais (produtos recentes)
    { spec: { created_at: -1 }, options: { name: "created_at_desc" } },
    // Índice parcial para atributos de smartphones (selectividade alta)
    {
      spec: { "attributes.5g_capable": 1 },
      options: {
        name: "attr_5g_capable",
        partialFilterExpression: { "attributes.5g_capable": { $exists: true } },
      },
    },
  ];

  for (const idx of indexes) {
    try {
      await collection.createIndex(idx.spec, idx.options);
      console.log(`   ✓ Índice criado: ${idx.options.name}`);
    } catch (err) {
      if (err.code === 85 || err.code === 86) {
        console.log(`   ↩ Índice já existe: ${idx.options.name}`);
      } else {
        throw err;
      }
    }
  }
  console.log("   Indexação concluída.\n");
}

// ---------------------------------------------------------------------------
// FUNÇÃO PRINCIPAL — SEEDING ORQUESTRADO
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();

  console.log("════════════════════════════════════════════════════════════");
  console.log("  SGBD II — Data Seeding | Catálogo de Produtos Dinâmico");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  Total de documentos: ${CONFIG.totalDocs.toLocaleString()}`);
  console.log(`  Tamanho do lote:     ${CONFIG.batchSize}`);
  console.log(`  Base de dados:       ${CONFIG.dbName}`);
  console.log(`  Coleção:             ${CONFIG.collection}`);
  console.log("════════════════════════════════════════════════════════════\n");

  let client;
  try {
    console.log("🔌 A conectar ao Replica Set MongoDB...");
    client = new MongoClient(CONFIG.uri, {
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
    });
    await client.connect();

    // Verificar que estamos conectados ao Replica Set correto
    const adminDb = client.db("admin");
    const rsStatus = await adminDb.command({ replSetGetStatus: 1 });
    const primary = rsStatus.members.find((m) => m.stateStr === "PRIMARY");
    const secondary = rsStatus.members.filter(
      (m) => m.stateStr === "SECONDARY",
    );
    console.log(`✅ Conectado ao Replica Set '${rsStatus.set}'`);
    console.log(`   → Primário:     ${primary?.name}`);
    secondary.forEach((s) => console.log(`   → Secundário:   ${s.name}`));
    console.log();

    const db = client.db(CONFIG.dbName);
    const collection = db.collection(CONFIG.collection);

    // Criar índices antes do seeding
    await createIndexes(collection);

    // Verificar documentos já existentes
    const existingCount = await collection.countDocuments();
    if (existingCount > 0) {
      console.log(
        `⚠️  A coleção já contém ${existingCount.toLocaleString()} documentos.`,
      );
      console.log("   A adicionar documentos aos existentes...\n");
    }

    // ── INSERÇÃO EM LOTES (BULK WRITE) ──────────────────────────────────────
    console.log(
      `🌱 A iniciar geração e inserção de ${CONFIG.totalDocs.toLocaleString()} documentos...\n`,
    );

    let totalInserted = 0;
    let batchNumber = 0;
    const totalBatches = Math.ceil(CONFIG.totalDocs / CONFIG.batchSize);

    while (totalInserted < CONFIG.totalDocs) {
      const remaining = CONFIG.totalDocs - totalInserted;
      const currentBatch = Math.min(CONFIG.batchSize, remaining);
      batchNumber++;

      // Gerar lote de documentos
      const batchDocs = Array.from({ length: currentBatch }, generateProduct);

      // Inserção via insertMany com ordered:false para máxima performance
      // (continua em caso de erro de duplicado — improvável mas defensivo)
      const result = await collection.insertMany(batchDocs, { ordered: false });
      totalInserted += result.insertedCount;

      // Barra de progresso em consola
      const pct = ((totalInserted / CONFIG.totalDocs) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const docsPerS = (
        totalInserted /
        ((Date.now() - startTime) / 1000)
      ).toFixed(0);
      const barLen = 30;
      const filled = Math.round((totalInserted / CONFIG.totalDocs) * barLen);
      const bar = "█".repeat(filled) + "░".repeat(barLen - filled);

      process.stdout.write(
        `\r  [${bar}] ${pct}%  |  ${totalInserted.toLocaleString()}/${CONFIG.totalDocs.toLocaleString()}  |  ${docsPerS} docs/s  |  ${elapsed}s`,
      );
    }

    console.log("\n");

    // ── VERIFICAÇÃO FINAL ────────────────────────────────────────────────────
    const finalCount = await collection.countDocuments();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log("════════════════════════════════════════════════════════════");
    console.log("  ✅ SEEDING CONCLUÍDO COM SUCESSO");
    console.log("════════════════════════════════════════════════════════════");
    console.log(`  Documentos na coleção:  ${finalCount.toLocaleString()}`);
    console.log(`  Tempo total:            ${elapsed}s`);
    console.log(
      `  Throughput médio:       ${(CONFIG.totalDocs / elapsed).toFixed(0)} docs/s`,
    );

    // Estatísticas de distribuição por categoria
    console.log("\n📊 Distribuição por categoria:");
    const catStats = await collection
      .aggregate([
        { $group: { _id: "$category.name", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray();
    catStats.forEach((c) => {
      const pct = ((c.count / finalCount) * 100).toFixed(1);
      const bar = "▪".repeat(Math.round(pct / 2));
      console.log(
        `   ${c._id.padEnd(35)} ${bar} ${c.count.toLocaleString()} (${pct}%)`,
      );
    });

    // Estatísticas de status
    console.log("\n📊 Distribuição por status:");
    const statusStats = await collection
      .aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray();
    statusStats.forEach((s) => {
      console.log(`   ${s._id.padEnd(20)} ${s.count.toLocaleString()}`);
    });

    console.log(
      "\n  Pronto! Execute 'node indexes.js' se os índices ainda não foram criados.",
    );
    console.log(
      "════════════════════════════════════════════════════════════\n",
    );
  } catch (err) {
    console.error("\n\n❌ ERRO durante o seeding:", err.message);
    if (err.code === "ECONNREFUSED") {
      console.error(
        "   → Verifique se o Docker Compose está em execução: docker-compose up -d",
      );
    }
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
}

main();
