use anyhow::Result;
use clap::{Parser, Subcommand};

// Include the generated client
include!(concat!(env!("OUT_DIR"), "/client.rs"));

#[derive(Parser)]
#[command(name = "client-template")]
#[command(about = "Example client for service-template API")]
struct Cli {
    /// Base URL of the service
    #[arg(long, default_value = "http://127.0.0.1:8080")]
    base_url: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Check service health
    Health,
    /// List all users
    ListUsers {
        /// Maximum number of users to return
        #[arg(long)]
        limit: Option<u32>,
        /// Number of users to skip
        #[arg(long)]
        offset: Option<u32>,
    },
    /// Get a specific user by ID
    GetUser {
        /// User ID
        user_id: u64,
    },
    /// Create a new user
    CreateUser {
        /// User name
        #[arg(long)]
        name: String,
        /// User email
        #[arg(long)]
        email: String,
    },
    /// Delete a user
    DeleteUser {
        /// User ID
        user_id: u64,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Create the client - this will only work if the OpenAPI spec exists and the client was generated
    // If using the placeholder client, this will compile but operations will fail at runtime
    let _client = match std::panic::catch_unwind(|| Client::new(&cli.base_url)) {
        Ok(client) => client,
        Err(_) => {
            eprintln!("Error: Client not properly generated!");
            eprintln!("Run the following commands from the workspace root:");
            eprintln!("  1. cargo xtask openapi --service service-template");
            eprintln!("  2. cd client-template && cargo build");
            std::process::exit(1);
        }
    };

    match cli.command {
        Commands::Health => {
            println!("Checking service health...");
            // Note: This is a placeholder - the actual implementation would depend on the generated client
            println!("Health check would be performed here with the generated client");
        }
        Commands::ListUsers { limit, offset } => {
            println!("Listing users...");
            if let Some(limit) = limit {
                println!("  Limit: {}", limit);
            }
            if let Some(offset) = offset {
                println!("  Offset: {}", offset);
            }
            println!("User listing would be performed here with the generated client");
        }
        Commands::GetUser { user_id } => {
            println!("Getting user with ID: {}", user_id);
            println!("User retrieval would be performed here with the generated client");
        }
        Commands::CreateUser { name, email } => {
            println!("Creating user: {} <{}>", name, email);
            println!("User creation would be performed here with the generated client");
        }
        Commands::DeleteUser { user_id } => {
            println!("Deleting user with ID: {}", user_id);
            println!("User deletion would be performed here with the generated client");
        }
    }

    Ok(())
}

// Example of how to use the generated client once it's properly generated:
#[allow(dead_code)]
async fn example_client_usage() -> Result<()> {
    let _client = Client::new("http://127.0.0.1:8080");

    // These methods would be available once the client is generated from the OpenAPI spec:
    // let health = client.health().send().await?;
    // let users = client.list_users().limit(10).send().await?;
    // let user = client.get_user().user_id(1).send().await?;
    // let new_user = client.create_user().body(&CreateUserRequest {
    //     name: "John Doe".to_string(),
    //     email: "john@example.com".to_string(),
    // }).send().await?;
    // client.delete_user().user_id(1).send().await?;

    Ok(())
}
