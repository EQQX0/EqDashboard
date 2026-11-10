package com.eqqx2.samsungserver.data

fun httpFailureText(code: Int, bodyPeek: String?): String {
    if (code != 530) return "Server returned HTTP $code"
    val suffix = if (bodyPeek?.contains("1033") == true) " (error 1033)" else ""
    return "Server unreachable (tunnel offline). Cloudflare has no live connection to your phone. " +
        "On the phone run: node ~/samsung-server/agent/tunnel-doctor.js --probe" + suffix
}
