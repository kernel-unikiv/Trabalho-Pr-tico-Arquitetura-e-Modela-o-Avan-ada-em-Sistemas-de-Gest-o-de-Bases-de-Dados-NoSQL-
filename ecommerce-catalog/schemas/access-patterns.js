// =============================================================================
// PADRÕES DE ACESSO (ACCESS PATTERNS) — Query-Driven Design
// Catálogo de Produtos Dinâmico | SGBD II 2025/2026
//
// Este ficheiro documenta as 5 queries complexas que justificam cada
// decisão de modelação tomada no product.schema.json.
// Cada query é acompanhada de:
//   - Descrição do caso de uso e frequência estimada
//   - Justificação da decisão de schema que a suporta
//   - Código de implementação (MongoDB Aggregation Framework / MQL)
//   - Índices necessários para performance O(log n)
// =============================================================================


// =============================================================================
// QA-01 — PESQUISA FACETADA MULTI-FILTRO COM TEXTO COMPLETO
// Frequência: MUITO ALTA (>60% de todos os requests de leitura)
// Caso de uso: Motor de busca do catálogo — "Procurar smartphones Android
//              abaixo de 500 USD com 5G, ordenados por relevância"
//
// DECISÃO DE SCHEMA JUSTIFICADA:
//   - Campo 'tags' e 'name'/'description' incluídos no Atlas Search / text index
//     com pesos diferenciados (name: peso 10, tags: 5, description: 2)
//   - 'price.current' como Decimal128 permite filtros $gte/$lte precisos
//   - 'category.path' com índice de prefixo suporta filtro de subárvore via $regex
//   - 'attributes' como subdocumento livre permite filtros em campos específicos
//     de categoria (ex: attributes.5g_capable: true) — impossível em EAV relacional
//     sem joins dinâmicos custosos
//
// ÍNDICES NECESSÁRIOS:
//   db.products.createIndex({ "status": 1, "category.path": 1, "price.current": 1 })
//   db.products.createIndex({ "$**": "text" }, { weights: { name: 10, tags: 5, description: 2 } })
//   db.products.createIndex({ "attributes.5g_capable": 1 })  // índice seletivo por atributo
// =============================================================================

db.products.aggregate([
  // ESTÁGIO 1: Filtro inicial com índice composto (status + category.path + price)
  // MongoDB executa este $match antes de qualquer operação — usa o índice para
  // eliminar documentos irrelevantes sem carregar para memória.
  {
    $match: {
      status: "active",
      "category.path": { $regex: "^/eletronicos/smartphones" },
      "price.current": { $gte: Decimal128("50"), $lte: Decimal128("500") },
      "attributes.5g_capable": true,
      $text: { $search: "android flagship" }
    }
  },

  // ESTÁGIO 2: Projeção com score de relevância textual para ordenação
  {
    $addFields: {
      textScore: { $meta: "textScore" },
      // Campo calculado: stock efetivo disponível para o cliente
      effective_stock: { $subtract: ["$stock.quantity", "$stock.reserved"] }
    }
  },

  // ESTÁGIO 3: Ordenação multi-critério — relevância textual primária, preço secundário
  {
    $sort: {
      textScore: { $meta: "textScore" },
      "price.current": 1
    }
  },

  // ESTÁGIO 4: Paginação — skip/limit com cursor para datasets grandes
  // Em produção, substituir por keyset pagination (range query em _id) para O(1)
  { $skip: 0 },
  { $limit: 20 },

  // ESTÁGIO 5: Projeção final — retorna apenas campos necessários para o card do catálogo
  // Exclui o array 'reviews' completo e 'description' longa — reduz payload de rede
  {
    $project: {
      name: 1, slug: 1, brand: 1,
      "price.current": 1, "price.currency": 1, "price.discount_pct": 1,
      "category.name": 1, "category.breadcrumb": 1,
      "rating_summary.average": 1, "rating_summary.count": 1,
      "images": { $filter: { input: "$images", as: "img", cond: { $eq: ["$$img.is_primary", true] } } },
      effective_stock: 1,
      textScore: 1
    }
  }
]);


// =============================================================================
// QA-02 — PIPELINE DE AGREGAÇÃO: RELATÓRIO DE STOCK E PREÇO MÉDIO POR CATEGORIA
// Frequência: MÉDIA (dashboard de gestão, executado a cada 30min ou sob demanda)
// Caso de uso: Painel de controlo de inventário — "Distribuição de stock e
//              preço médio por categoria de primeiro nível, com alertas de
//              stock crítico"
//
// DECISÃO DE SCHEMA JUSTIFICADA:
//   - 'category.path' com estrutura "/nivel1/nivel2/nivel3" permite extração
//     do nível 1 via $indexOfBytes + $substr — sem joins a tabela de categorias
//   - 'stock.quantity' e 'stock.reserved' como campos inteiros suportam $sum e
//     operações aritméticas nativas no pipeline
//   - 'price.current' como Decimal128 é convertido para Double no $avg
//     (comportamento nativo do aggregation framework)
//   - 'rating_summary' pré-computado (Computed Pattern) evita $unwind no array
//     de reviews — operação extremamente custosa em 100K+ documentos
//
// ÍNDICES NECESSÁRIOS:
//   db.products.createIndex({ "status": 1, "category.path": 1 })
//   db.products.createIndex({ "stock.quantity": 1 })
// =============================================================================

db.products.aggregate([
  // ESTÁGIO 1: Filtrar apenas produtos ativos com stock relevante
  {
    $match: {
      status: { $in: ["active", "out_of_stock"] }
    }
  },

  // ESTÁGIO 2: Extrair a categoria de primeiro nível do path materializado
  {
    $addFields: {
      // Extrai "/eletronicos" de "/eletronicos/smartphones/android"
      // $indexOfBytes localiza o segundo '/' ; $substrBytes extrai o segmento
      category_l1: {
        $let: {
          vars: {
            secondSlash: {
              $indexOfBytes: [
                "$category.path",
                "/",
                1  // começa a procurar após o primeiro '/'
              ]
            }
          },
          in: {
            $cond: {
              if: { $eq: ["$$secondSlash", -1] },
              // Path tem apenas um nível (ex: "/eletronicos")
              then: "$category.path",
              else: { $substrBytes: ["$category.path", 0, "$$secondSlash"] }
            }
          }
        }
      },
      // Stock efetivo disponível para venda
      effective_stock: { $subtract: ["$stock.quantity", "$stock.reserved"] },
      // Flag para produtos em stock crítico (abaixo do threshold definido)
      is_low_stock: {
        $cond: {
          if: {
            $and: [
              { $gt: ["$stock.low_stock_threshold", 0] },
              { $lte: ["$stock.quantity", "$stock.low_stock_threshold"] }
            ]
          },
          then: true,
          else: false
        }
      }
    }
  },

  // ESTÁGIO 3: Agrupar por categoria de primeiro nível
  {
    $group: {
      _id: "$category_l1",
      total_products: { $sum: 1 },
      total_stock_units: { $sum: "$stock.quantity" },
      total_reserved_units: { $sum: "$stock.reserved" },
      avg_price_usd: { $avg: { $toDouble: "$price.current" } },
      min_price: { $min: { $toDouble: "$price.current" } },
      max_price: { $max: { $toDouble: "$price.current" } },
      avg_rating: { $avg: "$rating_summary.average" },
      products_out_of_stock: {
        $sum: { $cond: [{ $eq: ["$stock.quantity", 0] }, 1, 0] }
      },
      products_low_stock: {
        $sum: { $cond: ["$is_low_stock", 1, 0] }
      },
      total_review_count: { $sum: "$rating_summary.count" }
    }
  },

  // ESTÁGIO 4: Calcular métricas derivadas e formatar saída
  {
    $addFields: {
      available_stock_units: { $subtract: ["$total_stock_units", "$total_reserved_units"] },
      stock_health_pct: {
        $multiply: [
          { $divide: [
            { $subtract: ["$total_stock_units", "$products_out_of_stock"] },
            { $max: ["$total_products", 1] }
          ]},
          100
        ]
      },
      avg_price_usd: { $round: ["$avg_price_usd", 2] }
    }
  },

  // ESTÁGIO 5: Ordenar por stock crítico (mais urgentes primeiro)
  { $sort: { products_low_stock: -1, products_out_of_stock: -1 } },

  // ESTÁGIO 6: Projeção limpa para o dashboard
  {
    $project: {
      _id: 0,
      category: "$_id",
      metrics: {
        total_products: "$total_products",
        available_stock: "$available_stock_units",
        out_of_stock_count: "$products_out_of_stock",
        low_stock_count: "$products_low_stock",
        stock_health_pct: { $round: ["$stock_health_pct", 1] }
      },
      pricing: {
        average_usd: "$avg_price_usd",
        min_usd: "$min_price",
        max_usd: "$max_price"
      },
      social_proof: {
        avg_rating: { $round: ["$avg_rating", 2] },
        total_reviews: "$total_review_count"
      }
    }
  }
]);


// =============================================================================
// QA-03 — PÁGINA DE DETALHE DE PRODUTO COM REVIEWS (LEITURA ÚNICA)
// Frequência: MUITO ALTA (segunda query mais frequente, ~25% de reads)
// Caso de uso: "Mostrar a página completa de um produto com os seus
//              atributos específicos, galeria de imagens e últimas reviews"
//
// DECISÃO DE SCHEMA JUSTIFICADA (a mais importante deste projeto):
//   - Reviews EMBUTIDAS (embedding) vs. coleção separada (referencing):
//     Com embedding: 1 leitura de disco = produto + reviews + rating_summary
//     Com referencing: 1 leitura (produto) + 1 $lookup (reviews) + sort + limit
//     Em MongoDB, $lookup entre coleções não beneficia de co-localização de dados
//     (ao contrário de JOINs em RDBMS com índices clustered) — o embedding é
//     genuinamente superior para este padrão de acesso dominante.
//   - Subset Pattern: apenas 10 reviews embutidas. Reviews adicionais servidas
//     via QA-04 (paginação separada) — mantém documento abaixo de 1MB.
//   - 'attributes' como subdocumento livre: retorna todos os atributos específicos
//     da categoria sem joins ou unions dinâmicos.
//   - 'category.breadcrumb' desnormalizado: renderização imediata do breadcrumb
//     no frontend sem chamada adicional.
//
// ÍNDICES NECESSÁRIOS:
//   db.products.createIndex({ "slug": 1 }, { unique: true })
// =============================================================================

db.products.findOne(
  {
    slug: "samsung-galaxy-s24-ultra-256gb-preto",
    status: "active"
  },
  {
    // Projeção explícita — retorna todos os campos relevantes para a página de detalhe
    // Exclui apenas campos internos/administrativos
    _id: 1, sku: 1, name: 1, slug: 1, description: 1, brand: 1,
    price: 1, category: 1, stock: 1, status: 1,
    attributes: 1, images: 1, tags: 1,
    // Reviews embutidas (Subset Pattern) — máx. 10 mais recentes
    reviews: { $slice: -10 },
    rating_summary: 1, seo: 1,
    created_at: 1, updated_at: 1
  }
);


// =============================================================================
// QA-04 — ATUALIZAÇÃO ATÓMICA PARCIAL: ADICIONAR REVIEW + ATUALIZAR RATING SUMMARY
// Frequência: MÉDIA (ocorre em ~2-5% das visitas a páginas de produto)
// Caso de uso: "Utilizador submete avaliação de 4 estrelas — adicionar ao array
//              de reviews, recalcular o rating_summary atomicamente e, se o
//              array atingiu 10 itens, remover a review mais antiga"
//
// DECISÃO DE SCHEMA JUSTIFICADA:
//   - $push com $sort e $slice: operação atómica nativa do MongoDB que adiciona
//     ao array, reordena e trunca num único comando — impossível de replicar
//     atomicamente em SQL sem stored procedures ou transações multi-statement.
//   - $inc para contadores: lock-free increment sem read-modify-write — o
//     MongoDB garante atomicidade a nível de documento para operações $inc,
//     eliminando race conditions em atualizações concorrentes de helpful_votes.
//   - Atualização do rating_summary com nova média calculada via $set:
//     Usa a fórmula de média incremental para evitar recalcular a partir de
//     todos os documentos do array (O(1) vs O(n)).
//
// NOTA: Em cenários de altíssima concorrência (>1000 writes/sec no mesmo
//       documento), considerar o Extended Reference Pattern com uma coleção
//       'product_reviews' separada e batch aggregation periódica.
//
// ÍNDICES NECESSÁRIOS: Nenhum adicional (operação por _id é O(1) via _id index)
// =============================================================================

// PARTE A: Inserir nova review e manter array com máx. 10 (Subset Pattern)
db.products.updateOne(
  { _id: ObjectId("produto_id_aqui") },
  [
    // Pipeline de update (MongoDB 4.2+) permite usar campos do documento
    // no lado direito da atualização — essencial para calcular a nova média
    {
      $set: {
        // Adicionar nova review ao array, ordenar por data desc, manter últimas 10
        reviews: {
          $slice: [
            {
              $sortArray: {
                input: {
                  $concatArrays: [
                    "$reviews",
                    [{
                      review_id: new ObjectId(),
                      user_id: "user_abc123",
                      username_snapshot: "João Silva",
                      rating: 4,
                      title: "Excelente smartphone",
                      body: "A câmera de 200MP é impressionante para fotografia noturna.",
                      helpful_votes: 0,
                      verified_purchase: true,
                      created_at: new Date()
                    }]
                  ]
                },
                sortBy: { created_at: -1 }
              }
            },
            10  // Manter apenas as 10 mais recentes (Subset Pattern)
          ]
        },
        // Incrementar contagem total de reviews
        "rating_summary.count": { $add: ["$rating_summary.count", 1] },
        // Calcular nova média incremental: avg_n = avg_(n-1) + (new_val - avg_(n-1)) / n
        "rating_summary.average": {
          $round: [
            {
              $add: [
                "$rating_summary.average",
                {
                  $divide: [
                    { $subtract: [4, "$rating_summary.average"] },
                    { $add: ["$rating_summary.count", 1] }
                  ]
                }
              ]
            },
            2
          ]
        },
        // Incrementar distribuição de ratings
        "rating_summary.distribution.4": {
          $add: [{ $ifNull: ["$rating_summary.distribution.4", 0] }, 1]
        },
        updated_at: new Date()
      }
    }
  ]
);


// =============================================================================
// QA-05 — PESQUISA GEOESPACIAL + DISPONIBILIDADE: PRODUTOS DISPONÍVEIS
//         NO ARMAZÉM MAIS PRÓXIMO
// Frequência: MÉDIA-ALTA (ativada em sessões com entrega expressa, ~30% de sessões)
// Caso de uso: "Dado a localização GPS do utilizador (Luanda: -8.8368, 13.2343),
//              encontrar produtos da categoria 'Eletrónica' com stock disponível
//              no armazém num raio de 50km, ordenados por distância"
//
// DECISÃO DE SCHEMA JUSTIFICADA:
//   - Extensão do schema de 'stock' para incluir 'warehouse_location' com
//     tipo GeoJSON Point — MongoDB suporta queries $near e $geoWithin nativamente
//     sem extensões (ao contrário de PostgreSQL que requer PostGIS separado)
//   - Índice 2dsphere é o único tipo que suporta geometria esférica correta
//     (em km) — o índice 2d é plano e incorreto para distâncias >100km
//   - stock.quantity > stock.reserved garante que apenas produtos com stock
//     real disponível são retornados — evita frustração do utilizador
//
// SCHEMA ESTENDIDO (adicionado ao subdocumento 'stock'):
//   "warehouse_location": {
//     "type": "Point",
//     "coordinates": [13.2543, -8.8159]  // [longitude, latitude] — ATENÇÃO: ordem GeoJSON
//   }
//
// ÍNDICES NECESSÁRIOS:
//   db.products.createIndex({ "stock.warehouse_location": "2dsphere" })
//   db.products.createIndex({ "status": 1, "category.path": 1, "stock.quantity": 1 })
// =============================================================================

db.products.aggregate([
  // ESTÁGIO 1: Filtro geoespacial — produtos em armazéns num raio de 50km
  // $geoNear DEVE ser o primeiro estágio do pipeline (limitação do MongoDB)
  {
    $geoNear: {
      near: {
        type: "Point",
        coordinates: [13.2343, -8.8368]  // [lon, lat] Luanda, Angola
      },
      distanceField: "warehouse_distance_m",
      maxDistance: 50000,  // 50km em metros
      spherical: true,     // Geometria esférica (haversine) — essencial para precisão
      query: {
        status: "active",
        "category.path": { $regex: "^/eletronicos" }
      }
    }
  },

  // ESTÁGIO 2: Filtrar apenas produtos com stock real disponível
  {
    $match: {
      $expr: {
        $gt: ["$stock.quantity", "$stock.reserved"]
      }
    }
  },

  // ESTÁGIO 3: Enriquecer com campos calculados
  {
    $addFields: {
      warehouse_distance_km: { $round: [{ $divide: ["$warehouse_distance_m", 1000] }, 1] },
      available_units: { $subtract: ["$stock.quantity", "$stock.reserved"] },
      estimated_delivery_hours: {
        // Lógica de negócio: <10km = 2h, 10-30km = 4h, 30-50km = 8h
        $switch: {
          branches: [
            { case: { $lte: ["$warehouse_distance_m", 10000] }, then: 2 },
            { case: { $lte: ["$warehouse_distance_m", 30000] }, then: 4 }
          ],
          default: 8
        }
      }
    }
  },

  // ESTÁGIO 4: Ordenar por distância (já implícito do $geoNear, mas explicitado)
  { $sort: { warehouse_distance_m: 1, "rating_summary.average": -1 } },

  { $limit: 50 },

  // ESTÁGIO 5: Projeção para card de produto com informação de entrega
  {
    $project: {
      name: 1, slug: 1, brand: 1,
      "price.current": 1, "price.currency": 1,
      "rating_summary.average": 1, "rating_summary.count": 1,
      "images": { $filter: { input: "$images", as: "img", cond: { $eq: ["$$img.is_primary", true] } } },
      available_units: 1,
      delivery: {
        warehouse_distance_km: "$warehouse_distance_km",
        estimated_hours: "$estimated_delivery_hours"
      }
    }
  }
]);
