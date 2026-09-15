// ============================================================
// platform.rs — What differs between Windows and macOS
//
// Mojang's version JSONs say which libraries and arguments each OS
// and CPU gets (rules), Java comes from Adoptium in a different
// archive and layout per OS, and classpaths are separated differently.
// ============================================================

use serde_json::Value;

/// The OS name Mojang's rules use for this build
pub const MOJANG_OS: &str = if cfg!(windows) {
    "windows"
} else if cfg!(target_os = "macos") {
    "osx"
} else {
    "linux"
};

/// Separator between classpath (and module path) entries
pub const CLASSPATH_SEPARATOR: &str = if cfg!(windows) { ";" } else { ":" };

/// Adoptium's name for this OS in its download API
pub const ADOPTIUM_OS: &str = if cfg!(windows) {
    "windows"
} else if cfg!(target_os = "macos") {
    "mac"
} else {
    "linux"
};

/// Adoptium's name for the CPU the Java runtime must match. The Windows launcher is an
/// x64 program, so it keeps x64 Java everywhere; on a Mac it's Apple silicon or Intel.
pub const ADOPTIUM_ARCH: &str = if cfg!(all(target_arch = "aarch64", not(windows))) { "aarch64" } else { "x64" };

/// Adoptium ships Windows runtimes as .zip and the others as .tar.gz
pub const JAVA_ARCHIVE_IS_ZIP: bool = cfg!(windows);

/// The Java runtime Adoptium serves for this OS and CPU: the latest GA JRE of `major`
pub fn adoptium_jre_url(major: u8) -> String {
    // /v3/binary/latest/{version}/{release_type}/{os}/{arch}/{image_type}/{jvm}/{heap}/{vendor}
    format!(
        "https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jre/hotspot/normal/eclipse",
        major, ADOPTIUM_OS, ADOPTIUM_ARCH
    )
}

/// Whether a Mojang `os.arch` value describes this build ("x86" means a 32-bit JVM)
fn arch_matches(arch: &str) -> bool {
    match arch {
        "x86" => cfg!(target_arch = "x86"),
        "x86_64" | "amd64" => cfg!(target_arch = "x86_64"),
        "arm64" | "aarch64" => cfg!(target_arch = "aarch64"),
        _ => false,
    }
}

/// One rule applies when everything it names matches: the OS, the CPU, and launcher features.
/// The launcher never has any of Mojang's features (demo, custom resolution, quick play
/// through the template), so a rule that asks for one doesn't apply.
fn rule_applies(rule: &Value) -> bool {
    let os = &rule["os"];
    if os["name"].as_str().is_some_and(|name| name != MOJANG_OS) {
        return false;
    }
    if os["arch"].as_str().is_some_and(|arch| !arch_matches(arch)) {
        return false;
    }
    if rule["features"].as_object().is_some_and(|f| f.values().any(|v| v.as_bool() == Some(true))) {
        return false;
    }
    true
}

/// Mojang's rules for a library or argument: no rules means allowed; otherwise the last
/// rule that applies decides, and nothing applying means disallowed.
pub fn rules_allow(rules: &Value) -> bool {
    let Some(rules) = rules.as_array() else { return true };
    let mut allowed = false;
    for rule in rules.iter().filter(|r| rule_applies(r)) {
        allowed = rule["action"].as_str().unwrap_or("allow") == "allow";
    }
    allowed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn allow_os(name: &str) -> Value {
        json!([{ "action": "allow", "os": { "name": name } }])
    }

    #[test]
    fn libraries_follow_the_os_rules() {
        assert!(rules_allow(&Value::Null));
        assert!(rules_allow(&allow_os(MOJANG_OS)));
        for other in ["windows", "osx", "linux"].into_iter().filter(|os| *os != MOJANG_OS) {
            assert!(!rules_allow(&allow_os(other)), "{other}");
        }
        // Old LWJGL 2 style: everywhere but one OS
        let all_but_osx = json!([{ "action": "allow" }, { "action": "disallow", "os": { "name": "osx" } }]);
        assert_eq!(rules_allow(&all_but_osx), MOJANG_OS != "osx");
    }

    #[test]
    fn arguments_for_features_and_other_cpus_are_left_out() {
        let demo = json!([{ "action": "allow", "features": { "is_demo_user": true } }]);
        assert!(!rules_allow(&demo));
        let x86 = json!([{ "action": "allow", "os": { "arch": "x86" } }]);
        assert!(!rules_allow(&x86));
    }

    #[test]
    fn macos_gets_its_own_java_and_first_thread_flag() {
        let first_thread = allow_os("osx");
        #[cfg(target_os = "macos")]
        {
            assert!(rules_allow(&first_thread));
            assert_eq!(CLASSPATH_SEPARATOR, ":");
            assert!(adoptium_jre_url(21).contains("/21/ga/mac/"));
            assert!(!JAVA_ARCHIVE_IS_ZIP);
            #[cfg(target_arch = "aarch64")]
            assert!(adoptium_jre_url(21).contains("/mac/aarch64/jre/"));
            #[cfg(target_arch = "x86_64")]
            assert!(adoptium_jre_url(21).contains("/mac/x64/jre/"));
        }
        #[cfg(windows)]
        {
            assert!(!rules_allow(&first_thread));
            assert_eq!(CLASSPATH_SEPARATOR, ";");
            assert!(adoptium_jre_url(21).ends_with("/21/ga/windows/x64/jre/hotspot/normal/eclipse"));
        }
    }
}
