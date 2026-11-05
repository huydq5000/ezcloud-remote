use std::{collections::HashMap, path::PathBuf, sync::OnceLock};

use hbb_common::log;

static FILE: OnceLock<HashMap<String, String>> = OnceLock::new();

pub fn get(key: &str) -> Option<String> {
    FILE.get_or_init(load).get(key).filter(|value| !value.is_empty()).cloned()
}

fn load() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Some(path) = locate() else {
        return map;
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => parse_into(&text, &mut map),
        Err(err) => log::error!("ezcloud.env {}: {err}", path.display()),
    }
    map
}

fn locate() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("EZCLOUD_ENV") {
        let path = PathBuf::from(path.trim());
        if path.is_file() {
            return Some(path);
        }
    }
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("ezcloud.env"));
            #[cfg(target_os = "macos")]
            candidates.push(dir.join("../Resources/ezcloud.env"));
        }
    }
    candidates.push(PathBuf::from("ezcloud.env"));
    candidates.into_iter().find(|path| path.is_file())
}

fn parse_into(text: &str, map: &mut HashMap<String, String>) {
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        map.insert(key.to_owned(), value.trim().trim_matches('"').to_owned());
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    #[test]
    fn parse_skips_comments_and_quotes() {
        let mut map = HashMap::new();
        parse_into(
            "# comment\n\nEZID_ISSUER=https://id.example\nEZCLOUD_BROKER=\"https://broker.example\"\n",
            &mut map,
        );
        assert_eq!(
            map.get("EZID_ISSUER").map(String::as_str),
            Some("https://id.example")
        );
        assert_eq!(
            map.get("EZCLOUD_BROKER").map(String::as_str),
            Some("https://broker.example")
        );
    }

    use super::parse_into;
}
