package com.eqqx2.samsungserver.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Remembers the user-granted Download/SamsungServer folder (no storage permissions needed). */
object PairFolder {
    private const val PREFS = "pair_folder"
    private const val KEY = "tree_uri"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun stored(context: Context): Uri? =
        prefs(context).getString(KEY, null)?.let { Uri.parse(it) }

    fun granted(context: Context): Boolean {
        val tree = stored(context) ?: return false
        val ok = try {
            context.contentResolver.persistedUriPermissions.any { it.uri == tree && it.isReadPermission }
        } catch (_: Exception) {
            false
        }
        if (!ok) prefs(context).edit().remove(KEY).apply()
        return ok
    }

    fun grantIntentInitialUri(): Uri =
        DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Download/SamsungServer")

    fun onTreePicked(context: Context, uri: Uri) {
        try {
            context.contentResolver.takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
            prefs(context).edit().putString(KEY, uri.toString()).apply()
        } catch (_: Exception) {
            // grant failed; stay ungranted
        }
    }

    suspend fun scan(context: Context): FoundPair? = withContext(Dispatchers.IO) {
        try {
            if (!granted(context)) return@withContext null
            val tree = stored(context) ?: return@withContext null
            val resolver = context.contentResolver
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
            val cands = ArrayList<PairCandidate>()
            resolver.query(
                children,
                arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                ),
                null, null, null,
            )?.use { c ->
                while (c.moveToNext()) {
                    val docId = c.getString(0) ?: continue
                    cands.add(
                        PairCandidate(
                            id = DocumentsContract.buildDocumentUriUsingTree(tree, docId).toString(),
                            name = c.getString(1) ?: "",
                            size = c.getLong(2),
                            modified = c.getLong(3),
                            isDir = c.getString(4) == DocumentsContract.Document.MIME_TYPE_DIR,
                        ),
                    )
                }
            }
            pickPairFile(cands) { resolver.openInputStream(Uri.parse(it.id)) }
        } catch (_: Exception) {
            null
        }
    }
}
