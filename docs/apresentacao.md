# Como apresentar o SignalDesk

Este guia é um roteiro de estudo e demonstração. Explique apenas o que você entende e consegue demonstrar; não apresente o projeto como experiência de produção.

## Resumo em 30 segundos

“O SignalDesk organiza a resposta a incidentes. Você registra o impacto, acompanha a investigação, documenta as ações e verifica a recuperação. O painel calcula a saúde dos serviços a partir dos incidentes abertos. Usei Node.js e SQLite para ter uma aplicação completa que pode ser executada localmente sem instalar dependências.”

## Demonstração de três minutos

1. Mostre o painel e explique que os dados iniciais são fictícios.
2. Abra um incidente crítico no serviço Web application. A saúde do serviço muda para Disrupted.
3. Registre uma nota com a hipótese investigada e avance para Identified.
4. Avance para Monitoring, depois Resolved. Mostre o histórico persistido e a recuperação do serviço.
5. Reabra o incidente para demonstrar que a regra de negócio recalcula os indicadores.
6. Use busca e filtros; mostre o resultado vazio quando não há correspondências.
7. Rode `npm test` e explique dois testes: transação sem escrita parcial e persistência após reabertura do banco.

## Perguntas que vale saber responder

**Por que não usar um framework?**

A escolha prioriza execução imediata, poucas peças e leitura direta das regras. Não é uma afirmação de que frameworks são desnecessários. Em uma aplicação maior, componentes, roteamento e validação padronizados reduziriam o custo de manutenção.

**O que impede um status inválido?**

O servidor define as transições permitidas. A interface mostra as opções retornadas pela API, mas a validação final continua no servidor. Um teste tenta pular da investigação para monitoramento e confirma que nem o status nem o histórico mudaram.

**Por que transações?**

O status e o evento de histórico representam uma única operação. Se uma parte falhar, ambas devem ser revertidas. O projeto usa transações SQLite para garantir isso.

**Como a saúde do serviço é calculada?**

Incidente crítico aberto: Disrupted. Outros incidentes abertos: Degraded. Nenhum incidente aberto: Operational. Resolver um de vários incidentes não torna o serviço saudável antes da hora.

**Isso está pronto para produção?**

Não. É uma demonstração local com operador único, sem login. Uma versão compartilhada precisaria de autenticação, autorização, controle de concorrência, paginação, migrações, backups, observabilidade e testes adicionais.

**Qual foi o uso de IA?**

O desenvolvimento teve assistência de IA. Explique quais partes você revisou, executou e estudou. Não atribua a si experiência ou decisões que você ainda não consegue justificar.

## Exercícios para dominar o projeto

- Leia o mapa de transições em `src/store.js` e desenhe o fluxo.
- Acompanhe um POST desde o formulário até o banco e de volta ao painel.
- Execute os testes e altere uma regra em uma branch de estudo para observar a falha correspondente.
- Implemente um pequeno aprimoramento próprio: responsável pelo incidente ou filtro de período, com validação e teste.
- Explique a diferença entre indicador calculado a partir de incidentes e monitoramento real de infraestrutura.

O projeto ainda não foi adaptado a uma empresa ou vaga específica. O próximo ajuste deve privilegiar as competências realmente exigidas no processo seletivo.
