//! JIRA REST API Client
//!
//! This client is auto-generated from the JIRA OpenAPI specification using Progenitor.
//! The spec is tracked at `openapi-specs/external/jira.json`.

// Include the generated client code
include!(concat!(env!("OUT_DIR"), "/client.rs"));

// Re-export common types for convenience
pub use types::*;
