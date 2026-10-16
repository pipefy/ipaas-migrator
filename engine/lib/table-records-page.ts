// Python que pagina table_records via OAuth client_credentials vira fetch JS.

export function isTableRecordsPagePython(python: string): boolean {
  const compact = python
    .replace(/#.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    compact.includes('table_records') &&
    compact.includes('client_credentials') &&
    compact.includes('all_records') &&
    compact.includes('pageInfo') &&
    compact.includes('def main')
  );
}

export function tableRecordsPageCode(): string {
  return `// py_eval/invoke_custom_py_code
export const code = async (inputs) => {
  const client_id = inputs.client_id;
  const client_secret = inputs.client_secret;
  const table_id = inputs.table_id;
  const tokenResponse = await fetch("https://app.pipefy.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id, client_secret }),
  });
  if (!tokenResponse.ok) throw new Error(await tokenResponse.text());
  const access_token = (await tokenResponse.json()).access_token;
  if (!access_token) throw new Error("Falha ao obter access_token. Verifique client_id/client_secret.");
  const headers = { Authorization: \`Bearer \${access_token}\`, "Content-Type": "application/json" };
  const buildQuery = (after_cursor) => {
    const after_part = after_cursor ? \`"\${after_cursor}"\` : "null";
    return {
      query: \`
            query {
              table_records(
                table_id: "\${table_id}",
                after: \${after_part},
                search: {
                  include_done: false,
                  title: "",
                  assignee_ids: [],
                  ignore_ids: [],
                  label_ids: [],
                  orderDirection: "asc"
                }
              ) {
                edges {
                  node {
                    id
                    title
                    record_fields {
                      name
                      array_value
                      value
                      float_value
                      date_value
                      datetime_value
                      report_value
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
            \`,
    };
  };
  const all_records = [];
  let cursor = null;
  let has_next = true;
  while (has_next) {
    const response = await fetch("https://api.pipefy.com/graphql", {
      method: "POST",
      headers,
      body: JSON.stringify(buildQuery(cursor)),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const table_data = data?.data?.table_records;
    if (!table_data) throw new Error("Tabela não encontrada ou resposta inválida da API Pipefy.");
    const edges = table_data.edges ?? [];
    for (const edge of edges) all_records.push(edge.node);
    const page_info = table_data.pageInfo ?? {};
    has_next = Boolean(page_info.hasNextPage);
    cursor = page_info.endCursor ?? null;
  }
  return { records: all_records };
};
`;
}
