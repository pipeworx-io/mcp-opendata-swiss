# mcp-opendata-swiss

opendata.swiss MCP — Switzerland's federal open-data portal (CKAN catalogue).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `search_datasets` | Search the opendata.swiss catalogue (CKAN package_search). Returns matching Swiss federal/cantonal datasets. Titles/descriptions are multilingual {de,fr,it,en}; each result is annotated with English-preferred `title_en`/`notes_en`. |
| `dataset_details` | Full metadata for one dataset (CKAN package_show) including its resources/distributions with download URLs. Use a dataset `name` (slug) or id from search_datasets. There is no datastore, so fetch `resources[].download_url`/`url` for the underlying data. |
| `list_organizations` | List publishing organizations (federal offices, cantons, etc.). Multilingual titles flattened to `title_en`. Use a returned `name` as `organization:<name>` in search_datasets `fq`. |
| `list_groups` | List thematic categories (CKAN groups / themes, e.g. health, education, energy). Multilingual titles flattened to `title_en`. Use a returned `name` as `groups:<name>` in search_datasets `fq`. |
| `list_tags` | List or search keyword tags used across the catalogue (CKAN tag_list). Useful for discovering facet values. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "opendata-swiss": {
      "url": "https://gateway.pipeworx.io/opendata-swiss/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Opendata Swiss data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
