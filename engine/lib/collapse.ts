// Colapsa provider Workato (ids de conector custom, aliases) para o slug canonico
// usado nas chaves do base-map. Lookup tenta a chave original e depois a colapsada.

const CONNECTOR_SUFFIX = /_connector_\d+(?:_\d+)?$/;

const RULES: [RegExp, string][] = [
  [/new_connector_6_connector_186728|pipefy|upload_attchments?|upload_attachment/i, 'pipefy'],
  [/new_connector_4_connector_186728_1620754526/i, 'whatsapp'],
  [/new_connector_4_connector_186728_1623952876/i, 'pdf'],
  [/new_connector_4_connector_186728_1617038418/i, 'custom_jobs'],
  [/new_connector_21_connector_186728/i, 'omie'],
  [/new_connector_22_connector_186728/i, 'lead'],
  [/^slack/i, 'slack'],
  [/^rest/i, 'rest'],
  [/google_sheets/i, 'google_sheets'],
  [/google_docs/i, 'google_docs'],
  [/google_forms/i, 'google_forms'],
  [/google_big_?query/i, 'google_bigquery'],
  [/google_drive/i, 'google_drive'],
  [/google_calendar/i, 'google_calendar'],
  [/google_people/i, 'google_people'],
  [/graph_ql/i, 'graphql'],
  [/teams_bot|^teams/i, 'teams'],
  [/azure_active_directory|microsoft_entra|cnh_azure/i, 'azure_ad'],
  [/microsoft_graph/i, 'microsoft_graph'],
  [/click_up/i, 'clickup'],
  [/pipedrive/i, 'pipedrive'],
  [/notion/i, 'notion'],
  [/freshdesk/i, 'freshdesk'],
  [/convert_api/i, 'convertapi'],
  [/pdf_monkey|pdfmonkey/i, 'pdf'],
  [/xml_parser|xml_creator/i, 'xml'],
  [/json_parser/i, 'json_parser'],
  [/csv_parser/i, 'csv_parser'],
  [/^ftps?$/i, 'sftp'],
  [/salesforce/i, 'salesforce'],
  [/netsuite/i, 'netsuite'],
  [/success_factors|sap_sf_/i, 'success_factors'],
  [/omie/i, 'omie'],
  [/personio/i, 'personio'],
  [/ceridian|dayforce/i, 'dayforce'],
  [/abbyy/i, 'abbyy'],
  [/jump_cloud/i, 'jump_cloud'],
  [/google_document_ai/i, 'google_document_ai'],
  [/workato_pub_sub/i, 'workato_pub_sub'],
  [/open_ai/i, 'open_ai'],
  [/^excel/i, 'excel'],
  [/^onedrive/i, 'onedrive'],
  [/microsoft_sharepoint/i, 'microsoft_sharepoint'],
  [/facebook_lead/i, 'facebook_lead_ads'],
];

export function collapseProvider(provider: string): string {
  for (const [rx, name] of RULES) {
    if (rx.test(provider)) return name;
  }
  const stripped = provider.replace(CONNECTOR_SUFFIX, '');
  return stripped.length > 0 ? stripped : provider;
}

export function collapseOpKey(opKey: string): string {
  const i = opKey.indexOf('/');
  if (i < 0) return opKey;
  return `${collapseProvider(opKey.slice(0, i))}/${opKey.slice(i + 1)}`;
}

export function lookupMap<T>(merged: Record<string, T>, opKey: string): T | undefined {
  if (merged[opKey]) return merged[opKey];
  const collapsed = collapseOpKey(opKey);
  if (collapsed !== opKey && merged[collapsed]) return merged[collapsed];
  const collapsedLower = collapsed.toLowerCase();
  for (const [k, v] of Object.entries(merged)) {
    if (k.toLowerCase() === collapsedLower || collapseOpKey(k).toLowerCase() === collapsedLower) {
      return v;
    }
  }
  return undefined;
}
