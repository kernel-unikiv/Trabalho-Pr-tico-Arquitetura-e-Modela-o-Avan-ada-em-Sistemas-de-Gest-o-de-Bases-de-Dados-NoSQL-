/**
 * =============================================================================
 * SCRIPT DE CRIAÇÃO DE ÍNDICES — Catálogo de Produtos Dinâmico
 * SGBD II | Ano Letivo 2025/2026
 *
 * Pode ser executado independentemente do seeding.
 * Idempotente: não falha se os índices já existirem.
 * Uso: node indexes.js
 * =============================================================================
 */

"use strict";

const { MongoClient } = require("mongodb");

const CONFIG = {
  uri:
    process.env.MONGO_URI ||
    "mongodb://localhost:27017/catalog_db?directConnection=true",
  dbName: "catalog_db",
  collection: "products",
};

/**
 * Definição completa de todos os índices da coleção 'products'.
 * Cada índice é documentado com:
 *   - query: qual query de acesso este índice suporta
 *   - tipo: tipo de índice MongoDB
 *   - justificação: razão técnica para a sua criação
 */
const INDEX_DEFINITIONS = [
  {
    spec: { sku: 1 },
    options: { unique: true, name: "idx_sku_unique" },
    meta: {
      query: "Lookup por SKU (gestão de inventário, EDI)",
      tipo: "B-Tree único",
      justificacao:
        "Garante integridade referencial do SKU e permite lookup O(log n). unique:true impõe constraint a nível de storage engine (WiredTiger), não apenas aplicacional.",
    },
  },
  {
    spec: { slug: 1 },
    options: { unique: true, name: "idx_slug_unique" },
    meta: {
      query: "QA-03 — Página de detalhe de produto por URL slug",
      tipo: "B-Tree único",
      justificacao:
        "Routing de URL SEO-friendly. unique:true previne colisões de slug que quebrariam links externos.",
    },
  },
  {
    spec: { status: 1, "category.path": 1, "price.current": 1 },
    options: { name: "idx_catalog_browse_compound" },
    meta: {
      query: "QA-01 — Pesquisa facetada; QA-02 — Relatório por categoria",
      tipo: "B-Tree composto",
      justificacao:
        "Índice composto ESR (Equality-Sort-Range): 'status' como campo de igualdade (alta seletividade — 80% dos docs são 'active'), 'category.path' como prefixo para subárvores, 'price.current' para range filters. A ordem dos campos segue a regra ESR do MongoDB para máxima cobertura de queries.",
    },
  },
  {
    spec: { "stock.quantity": 1, "stock.reserved": 1 },
    options: {
      name: "idx_stock_available",
      partialFilterExpression: { status: "active" },
    },
    meta: {
      query: "QA-02 — Relatório de stock; QA-05 — Filtro de disponibilidade",
      tipo: "B-Tree parcial",
      justificacao:
        "Índice parcial (Partial Index): indexa apenas documentos 'active', reduzindo o tamanho do índice em ~20% (percentagem de docs não-active). Mais eficiente em espaço e writes do que um índice total.",
    },
  },
  {
    spec: { name: "text", description: "text", tags: "text" },
    options: {
      weights: { name: 10, tags: 5, description: 2 },
      name: "idx_text_search_compound",
      default_language: "portuguese",
    },
    meta: {
      query: "QA-01 — Pesquisa full-text por palavra-chave",
      tipo: "Text Index (invertido)",
      justificacao:
        "Índice invertido com pesos diferenciados: ocorrência em 'name' vale 5x mais que em 'description'. default_language:'portuguese' ativa stemming para PT (ex: 'computadores' encontra 'computador'). Suporta operadores $text com relevância via $meta:textScore.",
    },
  },
  {
    spec: { "stock.warehouse_location": "2dsphere" },
    options: { name: "idx_warehouse_2dsphere" },
    meta: {
      query: "QA-05 — Pesquisa geoespacial por proximidade ao armazém",
      tipo: "2dsphere (geometria esférica)",
      justificacao:
        "Único tipo de índice que suporta GeoJSON com geometria esférica correta (haversine). Indispensável para $geoNear, $near e $geoWithin com $centerSphere. O índice 2d (plano) introduziria erros crescentes com a distância.",
    },
  },
  {
    spec: { brand: 1, status: 1, "price.current": 1 },
    options: { name: "idx_brand_status_price" },
    meta: {
      query: "QA-01 — Filtro facetado por marca",
      tipo: "B-Tree composto",
      justificacao:
        "Suporta queries de browse por marca com filtro de status e ordenação por preço — padrão comum em páginas de marca (ex: /marca/samsung).",
    },
  },
  {
    spec: { "rating_summary.average": -1, status: 1 },
    options: { name: "idx_rating_avg_desc" },
    meta: {
      query: "Ordenação 'Mais Bem Avaliados' na listagem de catálogo",
      tipo: "B-Tree descendente",
      justificacao:
        "Evita in-memory sort (SORT stage no explain plan) para a listagem de produtos mais bem avaliados — operação frequente na homepage e páginas de categoria.",
    },
  },
  {
    spec: { created_at: -1, status: 1 },
    options: { name: "idx_created_at_desc" },
    meta: {
      query: "Listagem 'Novidades' — produtos mais recentes",
      tipo: "B-Tree composto descendente",
      justificacao:
        "Suporta ordenação por data de criação descendente com pre-filter de status — usado na secção 'Novidades' do catálogo.",
    },
  },
  {
    spec: { "attributes.5g_capable": 1 },
    options: {
      name: "idx_attr_5g_capable_partial",
      partialFilterExpression: { "attributes.5g_capable": { $exists: true } },
    },
    meta: {
      query: "QA-01 — Filtro por atributo booleano de smartphone",
      tipo: "B-Tree parcial em campo dinâmico",
      justificacao:
        "Exemplo de indexação de um atributo dinâmico do subdocumento 'attributes'. O filtro parcial ($exists:true) limita o índice aos documentos da categoria 'smartphones', evitando indexar nulos de outros produtos — reduz tamanho do índice em ~85%.",
    },
  },
  {
    spec: { "price.discount_pct": 1, status: 1 },
    options: {
      name: "idx_discount_active_partial",
      partialFilterExpression: {
        "price.discount_pct": { $exists: true, $gt: 0 },
        status: "active",
      },
    },
    meta: {
      query: "Listagem 'Promoções' — produtos com desconto ativo",
      tipo: "B-Tree parcial",
      justificacao:
        "Indexa apenas o subconjunto de produtos em promoção ativa (~30% do catálogo). Queries de promoções são frequentes e beneficiam enormemente de um índice pequeno e altamente seletivo.",
    },
  },
];

async function main() {
  console.log("════════════════════════════════════════════════════════════");
  console.log("  SGBD II — Criação de Índices | Catálogo de Produtos");
  console.log("════════════════════════════════════════════════════════════\n");

  let client;
  try {
    client = new MongoClient(CONFIG.uri, { serverSelectionTimeoutMS: 8_000 });
    await client.connect();
    console.log("✅ Conectado ao MongoDB Replica Set\n");

    const collection = client.db(CONFIG.dbName).collection(CONFIG.collection);

    // Listar índices existentes antes
    const existingIndexes = await collection.indexes();
    console.log(`📋 Índices existentes: ${existingIndexes.length}\n`);

    console.log("📐 A criar/verificar índices:\n");

    let created = 0;
    let existing = 0;
    let errors = 0;

    for (const def of INDEX_DEFINITIONS) {
      try {
        const result = await collection.createIndex(def.spec, def.options);
        console.log(`  ✓ ${def.options.name}`);
        console.log(`    Query:  ${def.meta.query}`);
        console.log(`    Tipo:   ${def.meta.tipo}`);
        console.log(
          `    Razão:  ${def.meta.justificacao.substring(0, 120)}...`,
        );
        console.log();
        created++;
      } catch (err) {
        if (err.code === 85 || err.code === 86) {
          console.log(`  ↩ ${def.options.name} (já existe)`);
          existing++;
        } else {
          console.error(`  ✗ ${def.options.name} — ERRO: ${err.message}`);
          errors++;
        }
      }
    }

    // Estatísticas finais dos índices
    const finalIndexes = await collection.indexes();
    const stats = await collection.stats();

    console.log("════════════════════════════════════════════════════════════");
    console.log("  RESULTADO DA INDEXAÇÃO");
    console.log("════════════════════════════════════════════════════════════");
    console.log(`  Criados:          ${created}`);
    console.log(`  Já existiam:      ${existing}`);
    console.log(`  Erros:            ${errors}`);
    console.log(`  Total de índices: ${finalIndexes.length}`);
    console.log(
      `  Tamanho total dos índices: ${(stats.totalIndexSize / 1024 / 1024).toFixed(2)} MB`,
    );
    console.log(
      "════════════════════════════════════════════════════════════\n",
    );
  } catch (err) {
    console.error("❌ Erro:", err.message);
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
}

main();
