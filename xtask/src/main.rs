use anyhow::Result;
use clap::{Parser, Subcommand};
use std::process::Command;

#[derive(Parser)]
#[command(name = "xtask")]
#[command(about = "Build automation for Triton Rust monorepo")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate OpenAPI specifications (delegates to openapi-manager)
    Openapi {
        /// Generate specs for all services
        #[arg(long)]
        all: bool,
    },
    /// Regenerate all client libraries
    RegenClients,
    /// Run integration tests
    IntegrationTest,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Openapi { all } => {
            if all {
                generate_all_openapi_specs().await?;
            } else {
                println!("Generating OpenAPI specs...");
                println!("\nNote: OpenAPI generation is now managed by openapi-manager.");
                println!("Run the following command:");
                println!("  cd openapi-manager && cargo run -- generate");
                println!("\nThis uses Dropshot API traits for fast spec generation.");
            }
        }
        Commands::RegenClients => {
            regenerate_clients().await?;
        }
        Commands::IntegrationTest => {
            run_integration_tests().await?;
        }
    }

    Ok(())
}

async fn generate_all_openapi_specs() -> Result<()> {
    println!("Generating OpenAPI specs for all APIs...");
    println!("\nNote: OpenAPI generation is now managed by openapi-manager.");
    println!("This provides:");
    println!("  - Fast generation from API traits (no need to compile implementations)");
    println!("  - Automatic versioning and compatibility checking");
    println!("  - Centralized spec management");
    println!("\nRun the following command:");
    println!("  cd openapi-manager && cargo run -- generate");

    Ok(())
}

async fn regenerate_clients() -> Result<()> {
    println!("Regenerating all client libraries...");
    println!("\nNote: Clients now expect OpenAPI specs in openapi-specs/<api-name>/<api-name>.json");
    println!("Make sure to run `cd openapi-manager && cargo run -- generate` first.\n");

    let clients_dir = std::path::Path::new("clients");
    if !clients_dir.exists() {
        println!("No clients directory found.");
        return Ok(());
    }

    for entry in std::fs::read_dir(clients_dir)? {
        let entry = entry?;
        if entry.path().is_dir() {
            let client_name = entry.file_name().to_string_lossy().to_string();
            println!("Regenerating client: {}", client_name);

            let output = Command::new("cargo")
                .args(&["build"])
                .current_dir(entry.path())
                .output()?;

            if output.status.success() {
                println!("✅ Successfully regenerated {}", client_name);
            } else {
                println!(
                    "❌ Failed to regenerate {}: {}",
                    client_name,
                    String::from_utf8_lossy(&output.stderr)
                );
            }
        }
    }

    Ok(())
}

async fn run_integration_tests() -> Result<()> {
    println!("Running integration tests...");

    let output = Command::new("cargo")
        .args(&["test", "--workspace", "integration"])
        .output()?;

    if output.status.success() {
        println!("✅ All integration tests passed");
        println!("{}", String::from_utf8_lossy(&output.stdout));
    } else {
        println!("❌ Integration tests failed");
        println!("{}", String::from_utf8_lossy(&output.stderr));
    }

    Ok(())
}
