/**
 * =============================================================================
 * SCRIPT DE EXECUÇÃO DE QUERIES — Catálogo de Produtos Dinâmico
 * SGBD II | Ano Letivo 2025/2026
 *
 * Executa as 5 queries complexas documentadas no relatório técnico,
 * mede os tempos de execução reais e apresenta os resultados formatados.
 *
 * Uso: node queries.js
 * =============================================================================
 */

"use strict";

const { MongoClient, Decimal128 } = require("mongodb");

const MONGO_URI = process.env.MONGO_URI
  || "mongodb://localhost:27017/catalog_db?directConnection=true";

// ─── HELPER: medir latência de uma query ──────────────────────────────────────
async function measure(label, fn) {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end   = process.hrtime.bigint();
  const ms    = Number(end - start) / 1_000_000;
  return { label, ms: ms.toFixed(2), result };
}

function separator(title) {
  const line = "═".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
}

// ─── QA-01: PESQUISA FACETADA FULL-TEXT ──────────────────────────────────────
async function qa01(db) {
  return db.collection("products").aggregate([
    {
      $match: {
        status: "active",
        "category.path": { $regex: "^/eletronicos/smartphones" },
        "price.current": {
          $gte: Decimal128.fromString("50"),
          $lte: Decimal128.fromString("500"),
        },
        $text: { $search: "android" },
      },
    },
    { $addFields: { textScore: { $meta: "textScore" } } },
    { $sort: { textScore: { $meta: "textScore" }, "price.current": 1 } },
    { $limit: 5 },
    {
      $project: {
        _id: 0, name: 1, brand: 1,
        price: "$price.current",
        category: "$category.name",
        textScore: 1,
      },
    },
  ]).toArray();
}

// ─── QA-02: PIPELINE DE AGREGAÇÃO POR CATEGORIA ──────────────────────────────
async function qa02(db) {
  return db.collection("products").aggregate([
    { $match: { status: { $in: ["active", "out_of_stock"] } } },
    {
      $addFields: {
        category_l1: {
          $let: {
            vars: {
              secondSlash: { $indexOfBytes: ["$category.path", "/", 1] },
            },
            in: {
              $cond: {
                if: { $eq: ["$$secondSlash", -1] },
                then: "$category.path",
                else: { $substrBytes: ["$category.path", 0, "$$secondSlash"] },
              },
            },
          },
        },
        is_low_stock: {
          $cond: {
            if: {
              $and: [
                { $gt: ["$stock.low_stock_threshold", 0] },
                { $lte: ["$stock.quantity", "$stock.low_stock_threshold"] },
              ],
            },
            then: true,
            else: false,
          },
        },
      },
    },
    {
      $group: {
        _id: "$category_l1",
        total_produtos: { $sum: 1 },
        stock_total: { $sum: "$stock.quantity" },
        preco_medio_usd: { $avg: { $toDouble: "$price.current" } },
        produtos_sem_stock: {
          $sum: { $cond: [{ $eq: ["$stock.quantity", 0] }, 1, 0] },
        },
        produtos_stock_baixo: { $sum: { $cond: ["$is_low_stock", 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        familia: "$_id",
        total_produtos: 1,
        stock_total: 1,
        preco_medio_usd: { $round: ["$preco_medio_usd", 2] },
        produtos_sem_stock: 1,
        alertas_stock_baixo: "$produtos_stock_baixo",
      },
    },
    { $sort: { alertas_stock_baixo: -1 } },
  ]).toArray();
}

// ─── QA-03: PÁGINA DE DETALHE POR SLUG ───────────────────────────────────────
async function qa03(db) {
  // Busca primeiro um slug real da coleção
  const sample = await db.collection("products")
    .findOne({ status: "active" }, { projection: { slug: 1 } });

  if (!sample) return null;

  return db.collection("products").findOne(
    { slug: sample.slug, status: "active" },
    {
      projection: {
        name: 1, brand: 1, price: 1,
        "category.name": 1, "category.breadcrumb": 1,
        "stock.quantity": 1, "stock.reserved": 1,
        rating_summary: 1,
        reviews: { $slice: -3 }, // últimas 3 para visualização
        attributes: 1,
        slug: 1,
      },
    }
  );
}

// ─── QA-04: ATUALIZAÇÃO ATÓMICA DE REVIEW ────────────────────────────────────
async function qa04(db) {
  // Busca um produto ativo para atualizar
  const produto = await db.collection("products")
    .findOne({ status: "active" }, { projection: { _id: 1, rating_summary: 1 } });

  if (!produto) return null;

  const { ObjectId } = require("mongodb");

  const novaReview = {
    review_id:         new ObjectId(),
    user_id:           "user_teste_qa04",
    username_snapshot: "Avaliador Teste",
    rating:            5,
    title:             "Query de teste QA-04 — Atualização atómica",
    body:              "Esta review foi inserida pelo script de queries para demonstrar a atualização atómica.",
    helpful_votes:     0,
    verified_purchase: true,
    created_at:        new Date(),
  };

  const result = await db.collection("products").updateOne(
    { _id: produto._id },
    [
      {
        $set: {
          reviews: {
            $slice: [
              {
                $sortArray: {
                  input: { $concatArrays: ["$reviews", [novaReview]] },
                  sortBy: { created_at: -1 },
                },
              },
              10,
            ],
          },
          "rating_summary.count": { $add: ["$rating_summary.count", 1] },
          "rating_summary.average": {
            $round: [
              {
                $add: [
                  "$rating_summary.average",
                  {
                    $divide: [
                      { $subtract: [5, "$rating_summary.average"] },
                      { $add: ["$rating_summary.count", 1] },
                    ],
                  },
                ],
              },
              2,
            ],
          },
          updated_at: new Date(),
        },
      },
    ]
  );

  // Busca o documento atualizado para mostrar o resultado
  const atualizado = await db.collection("products").findOne(
    { _id: produto._id },
    { projection: { "rating_summary": 1, "reviews": { $slice: -1 } } }
  );

  return {
    matchedCount:  result.matchedCount,
    modifiedCount: result.modifiedCount,
    rating_summary_antes: produto.rating_summary,
    rating_summary_depois: atualizado.rating_summary,
    ultima_review_inserida: atualizado.reviews?.[0]?.title,
  };
}

// ─── QA-05: PESQUISA GEOESPACIAL ─────────────────────────────────────────────
async function qa05(db) {
  return db.collection("products").aggregate([
    {
      $geoNear: {
        near: {
          type: "Point",
          coordinates: [13.2343, -8.8368], // Luanda, Angola
        },
        distanceField: "warehouse_distance_m",
        maxDistance: 50000, // 50km
        spherical: true,
        query: {
          status: "active",
          "category.path": { $regex: "^/eletronicos" },
        },
      },
    },
    {
      $match: {
        $expr: { $gt: ["$stock.quantity", "$stock.reserved"] },
      },
    },
    {
      $addFields: {
        distancia_km: { $round: [{ $divide: ["$warehouse_distance_m", 1000] }, 1] },
        stock_disponivel: { $subtract: ["$stock.quantity", "$stock.reserved"] },
        entrega_estimada_horas: {
          $switch: {
            branches: [
              { case: { $lte: ["$warehouse_distance_m", 10000] }, then: "2h" },
              { case: { $lte: ["$warehouse_distance_m", 30000] }, then: "4h" },
            ],
            default: "8h",
          },
        },
      },
    },
    { $limit: 5 },
    {
      $project: {
        _id: 0, name: 1, brand: 1,
        preco: "$price.current",
        distancia_km: 1,
        stock_disponivel: 1,
        entrega_estimada_horas: 1,
        armazem: "$stock.warehouse_id",
      },
    },
  ]).toArray();
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("════════════════════════════════════════════════════════════");
  console.log("  SGBD II — Execução de Queries | Catálogo de Produtos");
  console.log("════════════════════════════════════════════════════════════");

  let client;
  try {
    client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const db = client.db("catalog_db");

    const total = await db.collection("products").countDocuments();
    console.log(`\n✅ Conectado | Documentos na coleção: ${total.toLocaleString()}\n`);

    // ── QA-01 ──────────────────────────────────────────────────────────────
    separator("QA-01 — Pesquisa Facetada Full-Text Multi-Filtro");
    const r1 = await measure("QA-01", () => qa01(db));
    console.log(`⏱  Latência: ${r1.ms} ms`);
    console.log(`📦 Resultados (top 5 de 20 possíveis):\n`);
    r1.result.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name}`);
      console.log(`     Marca: ${p.brand} | Categoria: ${p.category}`);
      console.log(`     Score Relevância: ${p.textScore?.toFixed(4) || "n/a"}\n`);
    });

    // ── QA-02 ──────────────────────────────────────────────────────────────
    separator("QA-02 — Relatório de Stock e Preço Médio por Categoria");
    const r2 = await measure("QA-02", () => qa02(db));
    console.log(`⏱  Latência: ${r2.ms} ms`);
    console.log(`📦 ${r2.result.length} famílias de categorias:\n`);
    r2.result.forEach(c => {
      console.log(`  📁 ${c.familia || "(raiz)"}`);
      console.log(`     Produtos: ${c.total_produtos?.toLocaleString()} | Stock Total: ${c.stock_total?.toLocaleString()}`);
      console.log(`     Preço Médio: $${c.preco_medio_usd} | Sem Stock: ${c.produtos_sem_stock} | Alertas: ${c.alertas_stock_baixo}\n`);
    });

    // ── QA-03 ──────────────────────────────────────────────────────────────
    separator("QA-03 — Página de Detalhe de Produto (Leitura Única)");
    const r3 = await measure("QA-03", () => qa03(db));
    console.log(`⏱  Latência: ${r3.ms} ms`);
    if (r3.result) {
      const p = r3.result;
      console.log(`📦 Produto encontrado:\n`);
      console.log(`  Nome:      ${p.name}`);
      console.log(`  Marca:     ${p.brand}`);
      console.log(`  Categoria: ${p.category?.name}`);
      console.log(`  Slug:      ${p.slug}`);
      console.log(`  Stock:     ${p.stock?.quantity} unid. (${p.stock?.reserved} reservadas)`);
      console.log(`  Rating:    ${p.rating_summary?.average}⭐ (${p.rating_summary?.count} avaliações)`);
      console.log(`  Reviews embutidas: ${p.reviews?.length || 0} (últimas 3 mostradas)`);
      console.log(`  Atributos dinâmicos: ${Object.keys(p.attributes || {}).length} campos`);
    }

    // ── QA-04 ──────────────────────────────────────────────────────────────
    separator("QA-04 — Atualização Atómica: Nova Review + Rating Summary");
    const r4 = await measure("QA-04", () => qa04(db));
    console.log(`⏱  Latência: ${r4.ms} ms`);
    if (r4.result) {
      const res = r4.result;
      console.log(`📦 Resultado da atualização:\n`);
      console.log(`  Documentos encontrados:  ${res.matchedCount}`);
      console.log(`  Documentos modificados:  ${res.modifiedCount}`);
      console.log(`  Rating ANTES:  avg=${res.rating_summary_antes?.average} | count=${res.rating_summary_antes?.count}`);
      console.log(`  Rating DEPOIS: avg=${res.rating_summary_depois?.average} | count=${res.rating_summary_depois?.count}`);
      console.log(`  Última review: "${res.ultima_review_inserida}"`);
    }

    // ── QA-05 ──────────────────────────────────────────────────────────────
    separator("QA-05 — Pesquisa Geoespacial (Luanda, 50km)");
    const r5 = await measure("QA-05", () => qa05(db));
    console.log(`⏱  Latência: ${r5.ms} ms`);
    console.log(`📦 ${r5.result.length} produtos de eletrónica próximos de Luanda:\n`);
    r5.result.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name}`);
      console.log(`     Armazém: ${p.armazem} | Distância: ${p.distancia_km} km`);
      console.log(`     Stock disponível: ${p.stock_disponivel} | Entrega: ${p.entrega_estimada_horas}\n`);
    });

    // ── SUMÁRIO FINAL ──────────────────────────────────────────────────────
    separator("SUMÁRIO DE DESEMPENHO");
    const queries = [r1, r2, r3, r4, r5];
    queries.forEach(q => {
      const bar = "█".repeat(Math.min(Math.round(parseFloat(q.ms) / 5), 30));
      console.log(`  ${q.label.padEnd(8)} ${bar} ${q.ms} ms`);
    });
    console.log(`\n  ✅ Todas as queries executadas com sucesso.`);
    console.log("════════════════════════════════════════════════════════════\n");

  } catch (err) {
    console.error("❌ Erro:", err.message);
    if (err.message.includes("ECONNREFUSED") || err.message.includes("ENOTFOUND")) {
      console.error("   → Verifica se o Docker está a correr: docker-compose up -d");
    }
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
}

main();
