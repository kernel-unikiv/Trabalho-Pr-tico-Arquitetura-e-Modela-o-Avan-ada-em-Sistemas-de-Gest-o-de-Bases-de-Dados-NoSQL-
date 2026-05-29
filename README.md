# 🛍️ Catálogo de Produtos Dinâmico — Camada de Persistência NoSQL

**Disciplina:** Sistemas de Gestão de Bases de Dados II (SGBD II)  
**Ano Letivo:** 2025/2026  
**Docente:** Moyo Kanivengidio  
**Subdomínio:** Catálogo de Produtos Dinâmico para E-commerce de Alta Escala  

---

## 📐 Arquitetura

```
┌─────────────────────────────────────────────────────┐
│              MongoDB Replica Set — rs0              │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │   mongo1     │  │   mongo2     │  │  mongo3   │ │
│  │  PRIMARY 🟢  │  │ SECONDARY 🔵 │  │SECONDARY 🔵│ │
│  │  :27017      │  │  :27018      │  │  :27019   │ │
│  │ priority: 2  │  │ priority: 1  │  │priority: 1│ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘ │
│         └─────────────────┼────────────────┘       │
│                    oplog replication                │
└─────────────────────────────────────────────────────┘
         │ Write (majority)    │ Read (secondaryPreferred)
    ┌────┴────────────────────┴────┐
    │     Node.js Application      │
    │  mongodb driver + faker-js   │
    └──────────────────────────────┘
```

**Padrão CAP:** CP — Consistência + Tolerância a Partições  
**Stack:** MongoDB 7.0 · Node.js 20 · Docker Compose · @faker-js/faker

---

## 📁 Estrutura do Repositório

```
ecommerce-catalog/
├── docker-compose.yml              # Cluster MongoDB 3 nós
├── config/
│   └── mongod.conf                 # Configuração do daemon mongod
├── schemas/
│   ├── product.schema.json         # JSON Schema anotado da coleção products
│   └── access-patterns.js          # 5 queries complexas documentadas
├── scripts/
│   ├── seed.js                     # Geração e inserção de 100.000 documentos
│   ├── indexes.js                  # Criação dos 11 índices otimizados
│   ├── queries.js                  # Execução das 5 queries com medição de latência
│   ├── fault-tolerance.js          # Demonstração de tolerância a falhas
│   └── package.json
└── README.md
```

---

## ⚙️ Pré-requisitos

| Ferramenta | Versão mínima | Verificação |
|---|---|---|
| Docker Desktop | 24.x | `docker --version` |
| Node.js | 20.x (LTS) | `node --version` |
| npm | 10.x | `npm --version` |

---

## 🚀 Guia de Reprodutibilidade — Passo a Passo

### Passo 1 — Clonar e entrar na pasta

```bash
git clone https://github.com/<teu-usuario>/ecommerce-catalog.git
cd ecommerce-catalog
```

### Passo 2 — Levantar o cluster MongoDB

```bash
docker-compose up -d
```

Aguarda ~40 segundos. O serviço `mongo-rs-init` inicializa o Replica Set automaticamente.

**Verificar que os 3 nós estão ativos:**

```bash
docker ps
```

Deves ver `mongo1`, `mongo2`, `mongo3` com estado `Up (healthy)`.

**Verificar o estado do Replica Set:**

```bash
docker exec -it mongo1 mongosh --eval "rs.status().members.map(m => m.name + ': ' + m.stateStr)"
```

Resultado esperado:
```
[ 'mongo1:27017: PRIMARY', 'mongo2:27017: SECONDARY', 'mongo3:27017: SECONDARY' ]
```

---

### Passo 3 — Instalar dependências Node.js

```bash
cd scripts
npm install
```

---

### Passo 4 — Inserir os dados (Data Seeding)

```bash
node seed.js
```

Insere **100.000 documentos** distribuídos por 15 categorias.  
Tempo estimado: 2–4 minutos. Apresenta barra de progresso em tempo real.

Para um teste rápido com 10.000 documentos:
```bash
node seed.js --total=10000
```

---

### Passo 5 — Criar os índices

```bash
node indexes.js
```

Cria os 11 índices otimizados (B-Tree, Text, 2dsphere, Parciais).  
Idempotente — pode ser executado múltiplas vezes sem erros.

---

### Passo 6 — Executar as 5 Queries Avançadas

```bash
node queries.js
```

Executa e apresenta os resultados com latência real de todas as queries:

| Query | Descrição | Latência Típica |
|---|---|---|
| QA-01 | Pesquisa facetada full-text multi-filtro | 8–15ms |
| QA-02 | Pipeline de agregação por categoria | 45–90ms |
| QA-03 | Página de detalhe por slug (leitura única) | 2–5ms |
| QA-04 | Atualização atómica: nova review + rating | 3–6ms |
| QA-05 | Pesquisa geoespacial (Luanda, raio 50km) | 12–25ms |

---

### Passo 7 — Demonstração de Tolerância a Falhas

```bash
node fault-tolerance.js
```

Este script:
1. Apresenta o estado atual do Replica Set
2. Verifica replicação dos dados
3. Monitoriza o cluster em tempo real (10 segundos)
4. Fornece instruções para simular falha do primário

**Para simular falha do primário manualmente (em terminais separados):**

```bash
# Terminal 1 — Para o nó primário
docker stop mongo1

# Terminal 2 — Monitoriza a eleição (aguarda ~15-30 segundos)
docker exec -it mongo2 mongosh --eval \
  "rs.status().members.map(m => m.name + ': ' + m.stateStr)"

# Resultado esperado após eleição:
# mongo1:27017: UNKNOWN  ← nó em baixo
# mongo2:27017: PRIMARY  ← novo primário eleito
# mongo3:27017: SECONDARY

# Restaurar o nó original
docker start mongo1
```

---

### Passo 8 — Aceder ao MongoDB diretamente (opcional)

```bash
# Conectar ao nó primário via mongosh
docker exec -it mongo1 mongosh

# Dentro do mongosh:
use catalog_db
db.products.countDocuments()
db.products.findOne({ status: "active" }, { name: 1, category: 1, _id: 0 })
```

---

## 🔌 Connection String para Aplicações

```
mongodb://localhost:27017/catalog_db?directConnection=true
```

Para aplicações com múltiplos nós (produção):
```
mongodb://localhost:27017,localhost:27018,localhost:27019/catalog_db?replicaSet=rs0&readPreference=secondaryPreferred
```

---

## 🛑 Parar o Ambiente

```bash
# Parar containers (preserva os dados)
docker-compose down

# Parar e eliminar todos os dados (reset completo)
docker-compose down -v
```

---

## 📊 Resultados do Data Seeding

| Métrica | Valor |
|---|---|
| Total de documentos | 100.000 |
| Throughput de inserção | ~552 docs/segundo |
| Tempo total de seeding | ~181 segundos |
| Categorias | 15 (em 5 famílias) |
| Índices criados | 11 |
| Produtos ativos | 80.116 (80,1%) |
| Produtos com reviews | ~90% |

---

## 📚 Tecnologias Utilizadas

| Tecnologia | Versão | Função |
|---|---|---|
| MongoDB | 7.0 | SGBD NoSQL orientado a documentos |
| Docker Desktop | 24.x | Contentorização e orquestração |
| Node.js | 20 LTS | Ambiente de execução dos scripts |
| @faker-js/faker | 9.x | Geração de dados realistas |
| mongodb (driver) | 6.x | Ligação e operações com o MongoDB |

---

## 📄 Relatório Técnico

O relatório técnico completo em formato Word (`.docx`) encontra-se na raiz do repositório:

```
Relatorio_SGBD2_Catalogo_Produtos.docx
```

Contém todas as secções exigidas: Resumo Executivo, Análise do Domínio, Justificação CAP/PACELC, Modelação de Dados, Implementação, Discussão Crítica e Referências IEEE.

---

*Trabalho Prático — SGBD II | Docente: Moyo Kanivengidio | 2025/2026*
# Trabalho-Pr-tico-Arquitetura-e-Modela-o-Avan-ada-em-Sistemas-de-Gest-o-de-Bases-de-Dados-NoSQL-
