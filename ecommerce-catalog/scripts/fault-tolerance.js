/**
 * =============================================================================
 * DEMONSTRAÇÃO DE TOLERÂNCIA A FALHAS — Replica Set MongoDB
 * SGBD II | Ano Letivo 2025/2026
 *
 * Este script demonstra o comportamento do Replica Set face a:
 *   1. Monitorização do estado do cluster em tempo real
 *   2. Verificação de replicação entre nós
 *   3. Instruções para simular falha do nó primário (via Docker)
 *
 * Uso: node fault-tolerance.js
 * =============================================================================
 */

"use strict";

const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGO_URI
  || "mongodb://localhost:27017/catalog_db?directConnection=true";

function separator(title) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getClusterStatus(db) {
  try {
    const status = await db.adminCommand({ replSetGetStatus: 1 });
    return status;
  } catch {
    return null;
  }
}

function printMemberStatus(members) {
  members.forEach(m => {
    const icon = m.stateStr === "PRIMARY"   ? "🟢 PRIMÁRIO  "
               : m.stateStr === "SECONDARY" ? "🔵 SECUNDÁRIO"
               : "🔴 " + m.stateStr.padEnd(11);
    const lag = m.optimeDate
      ? `| Lag: ${m.pingMs ?? "0"}ms`
      : "";
    console.log(`   ${icon} → ${m.name} (votes: ${m.votes ?? 1}) ${lag}`);
  });
}

async function main() {
  console.log("════════════════════════════════════════════════════════════");
  console.log("  SGBD II — Demonstração de Tolerância a Falhas");
  console.log("  MongoDB Replica Set rs0 | 3 Nós");
  console.log("════════════════════════════════════════════════════════════");

  let client;
  try {
    client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const db = client.db("admin");

    // ── FASE 1: Estado inicial do cluster ──────────────────────────────────
    separator("FASE 1 — Estado Inicial do Replica Set");
    const status1 = await getClusterStatus(db);

    if (!status1) {
      console.log("❌ Não foi possível obter o estado do Replica Set.");
      console.log("   Verifica se o Docker está a correr: docker-compose up -d");
      return;
    }

    console.log(`\n  Nome do Replica Set: ${status1.set}`);
    console.log(`  Membros ativos: ${status1.members.length}\n`);
    printMemberStatus(status1.members);

    const primario = status1.members.find(m => m.stateStr === "PRIMARY");
    const secundarios = status1.members.filter(m => m.stateStr === "SECONDARY");

    console.log(`\n  ✅ Cluster saudável: 1 primário + ${secundarios.length} secundários`);
    console.log(`  📌 Primário atual: ${primario?.name}`);

    // ── FASE 2: Verificar replicação ───────────────────────────────────────
    separator("FASE 2 — Verificação de Replicação");

    const catalogDb = client.db("catalog_db");
    const totalPrimario = await catalogDb.collection("products").countDocuments();
    console.log(`\n  Documentos no primário (${primario?.name}): ${totalPrimario.toLocaleString()}`);
    console.log(`\n  Para verificar replicação nos secundários, executa no terminal:`);
    console.log(`\n  docker exec -it mongo2 mongosh --eval \\`);
    console.log(`    "rs.secondaryOk(); db.getSiblingDB('catalog_db').products.countDocuments()"\n`);
    console.log(`  docker exec -it mongo3 mongosh --eval \\`);
    console.log(`    "rs.secondaryOk(); db.getSiblingDB('catalog_db').products.countDocuments()"\n`);
    console.log(`  ✅ Esperas o mesmo valor (${totalPrimario.toLocaleString()}) nos 3 nós — confirma replicação completa.`);

    // ── FASE 3: Instruções para simular falha ──────────────────────────────
    separator("FASE 3 — Simulação de Falha do Primário");

    console.log(`\n  PASSO 1 — Abre um NOVO terminal e para o nó primário:`);
    console.log(`\n    docker stop mongo1\n`);

    console.log(`  PASSO 2 — Aguarda 15-30 segundos (tempo de deteção + eleição)`);
    console.log(`  e depois verifica o novo primário:\n`);
    console.log(`    docker exec -it mongo2 mongosh --eval "rs.status().members.map(m => m.name + ': ' + m.stateStr)"\n`);

    console.log(`  RESULTADO ESPERADO:`);
    console.log(`    mongo1:27017 → UNKNOWN  (nó em baixo — não responde)`);
    console.log(`    mongo2:27017 → PRIMARY  (eleito automaticamente)`);
    console.log(`    mongo3:27017 → SECONDARY\n`);

    console.log(`  ANÁLISE CAP — O que aconteceu:`);
    console.log(`    • Deteção da falha: heartbeat timeout (~10s)`);
    console.log(`    • Eleição: mongo2 e mongo3 votam (quórum 2/3 atingido)`);
    console.log(`    • Novo primário ativo: ~15-30 segundos de downtime de escrita`);
    console.log(`    • Leituras dos secundários: NUNCA interrompidas (AP para leituras)`);
    console.log(`    • Escritas: indisponíveis durante a eleição (CP para escritas)\n`);

    console.log(`  PASSO 3 — Restaura o nó original:\n`);
    console.log(`    docker start mongo1\n`);
    console.log(`  O mongo1 rejunta o Replica Set como SECUNDÁRIO automaticamente.`);
    console.log(`  O MongoDB sincroniza o oplog para o colocar em dia.\n`);

    // ── FASE 4: Monitorização em tempo real ────────────────────────────────
    separator("FASE 4 — Monitorização em Tempo Real (10 segundos)");
    console.log(`\n  A monitorizar o estado do cluster a cada 2 segundos...\n`);

    for (let i = 0; i < 5; i++) {
      await sleep(2000);
      const statusAtual = await getClusterStatus(db);
      if (statusAtual) {
        const ts = new Date().toLocaleTimeString("pt-PT");
        console.log(`  [${ts}]`);
        printMemberStatus(statusAtual.members);
        console.log();
      }
    }

    // ── FASE 5: Teste de escrita com retryWrites ───────────────────────────
    separator("FASE 5 — Teste de Escrita com retryWrites");
    console.log(`\n  A testar inserção com retryWrites (resiliente a failover)...\n`);

    const testeCol = client.db("catalog_db").collection("fault_tolerance_log");
    const docTeste = {
      test_id:    `ft_test_${Date.now()}`,
      timestamp:  new Date(),
      descricao:  "Documento inserido durante o teste de tolerância a falhas",
      replica_set: status1.set,
      primario_no_momento: primario?.name,
    };

    await testeCol.insertOne(docTeste);
    console.log(`  ✅ Inserção bem-sucedida no Replica Set '${status1.set}'`);
    console.log(`  📄 Documento: test_id=${docTeste.test_id}`);
    console.log(`  📌 Primário no momento: ${docTeste.primario_no_momento}\n`);

    // Limpar documento de teste
    await testeCol.deleteOne({ test_id: docTeste.test_id });

    // ── SUMÁRIO FINAL ──────────────────────────────────────────────────────
    separator("SUMÁRIO — CONCLUSÕES PARA O RELATÓRIO");
    console.log(`
  Teorema CAP — Comportamento Observado do MongoDB Replica Set:

  ✅ CONSISTÊNCIA (C):
     Escritas com write concern {w:'majority'} só são confirmadas após
     persistência em 2/3 nós → dados nunca perdidos mesmo com 1 falha.

  ✅ TOLERÂNCIA A PARTIÇÕES (P):
     Quórum de 2/3 nós permite eleição de novo primário mesmo com
     1 nó em baixo → cluster permanece operacional.

  ⚠️  DISPONIBILIDADE (A) — Limitação Conhecida:
     Escritas ficam ~15-30s indisponíveis durante a eleição.
     Leituras de secundários NUNCA são interrompidas.

  CONCLUSÃO: MongoDB Replica Set é um sistema CP — prioriza
  Consistência sobre Disponibilidade total de escritas,
  em linha com as necessidades de um catálogo de produtos
  onde dados incorretos são mais prejudiciais do que
  indisponibilidade temporária de escrita.
`);
    console.log("════════════════════════════════════════════════════════════\n");

  } catch (err) {
    console.error("❌ Erro:", err.message);
  } finally {
    if (client) await client.close();
  }
}

main();
