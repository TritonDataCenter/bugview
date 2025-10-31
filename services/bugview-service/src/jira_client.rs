//! Minimal JIRA REST API client
//!
//! This module provides a lightweight client for the specific JIRA API endpoints
//! needed by bugview. Rather than using a large auto-generated client, we hand-write
//! just the operations we need.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// JIRA client configuration
#[derive(Clone)]
pub struct JiraClient {
    client: reqwest::Client,
    base_url: String,
    username: String,
    password: String,
}

/// Response from JIRA search endpoint (v3 API)
#[derive(Debug, Deserialize, Serialize)]
pub struct SearchResponse {
    #[serde(default)]
    pub total: Option<u32>,
    pub issues: Vec<IssueSearchResult>,
    #[serde(rename = "isLast", default)]
    pub is_last: Option<bool>,
    /// Next page token for cursor-based pagination (v3 API)
    #[serde(rename = "nextPageToken", default)]
    pub next_page_token: Option<String>,
}

/// Minimal issue information from search results
#[derive(Debug, Deserialize, Serialize)]
pub struct IssueSearchResult {
    pub key: String,
    pub fields: HashMap<String, serde_json::Value>,
}

/// Full issue details
#[derive(Debug, Deserialize, Serialize)]
pub struct Issue {
    pub key: String,
    pub id: String,
    pub fields: HashMap<String, serde_json::Value>,
    /// Rendered (HTML) versions of fields when expand=renderedFields is used
    #[serde(default, rename = "renderedFields")]
    pub rendered_fields: Option<HashMap<String, serde_json::Value>>,
}

/// Remote link information
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RemoteLink {
    pub id: u64,
    pub object: Option<RemoteLinkObject>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RemoteLinkObject {
    pub url: String,
    pub title: String,
}

impl JiraClient {
    /// Create a new JIRA client
    pub fn new(base_url: String, username: String, password: String) -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .user_agent("BugviewRust/0.1.0")
            .build()
            .context("Failed to create HTTP client")?;

        Ok(Self {
            client,
            base_url,
            username,
            password,
        })
    }

    /// Search for issues using JQL
    ///
    /// # Arguments
    /// * `labels` - Labels to filter by (combined with AND)
    /// * `page_token` - Optional pagination token (None for first page)
    /// * `sort` - Sort field (key, created, or updated)
    pub async fn search_issues(
        &self,
        labels: &[String],
        page_token: Option<&str>,
        sort: &str,
    ) -> Result<SearchResponse> {
        let max_results = 50;

        // Build JQL query
        let label_clauses: Vec<String> = labels
            .iter()
            .map(|label| format!("labels in (\"{}\")", label))
            .collect();
        let mut jql = label_clauses.join(" AND ");

        // Add sort clause
        if sort == "created" || sort == "updated" {
            if !jql.is_empty() {
                jql.push_str(" ");
            }
            jql.push_str(&format!("ORDER BY {} DESC", sort));
        }

        let url = format!("{}/rest/api/3/search/jql", self.base_url);

        // Build query parameters - use token-based pagination for v3 API
        let max_results_str = max_results.to_string();
        let mut query_params = vec![
            ("jql", jql.as_str()),
            ("maxResults", max_results_str.as_str()),
            ("fields", "summary,resolution,updated,created"),
        ];

        let token_string;
        if let Some(token) = page_token {
            token_string = token.to_string();
            query_params.push(("nextPageToken", &token_string));
        }

        // v3 API search/jql endpoint uses query parameters with token-based pagination
        let response = self
            .client
            .get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .query(&query_params)
            .send()
            .await
            .context("Failed to send search request")?;

        let status = response.status();

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("JIRA search failed with status {}: {}", status, body);
        }

        let search_response: SearchResponse = response
            .json()
            .await
            .context("Failed to parse search response")?;

        Ok(search_response)
    }

    /// Get a single issue by key
    ///
    /// # Arguments
    /// * `key` - Issue key (e.g., "PROJECT-123")
    pub async fn get_issue(&self, key: &str) -> Result<Issue> {
        if !key.contains('-') {
            anyhow::bail!("Invalid issue key: {}", key);
        }

        // Request rendered fields so JIRA converts markup to HTML for us
        let url = format!(
            "{}/rest/api/3/issue/{}?expand=renderedFields",
            self.base_url, key
        );

        let response = self
            .client
            .get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .context("Failed to send get issue request")?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            anyhow::bail!("Issue not found: {}", key);
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("JIRA get issue failed with status {}: {}", status, body);
        }

        response
            .json::<Issue>()
            .await
            .context("Failed to parse issue response")
    }

    /// Get remote links for an issue
    ///
    /// # Arguments
    /// * `issue_id` - Issue ID (numeric, not the key)
    #[allow(dead_code)]
    pub async fn get_remote_links(&self, issue_id: &str) -> Result<Vec<RemoteLink>> {
        if issue_id.contains('-') {
            anyhow::bail!("Issue ID must be numeric, not a key: {}", issue_id);
        }

        let url = format!(
            "{}/rest/api/3/issue/{}/remotelink",
            self.base_url, issue_id
        );

        let response = self
            .client
            .get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .context("Failed to send get remote links request")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!(
                "JIRA get remote links failed with status {}: {}",
                status,
                body
            );
        }

        response
            .json::<Vec<RemoteLink>>()
            .await
            .context("Failed to parse remote links response")
    }
}
