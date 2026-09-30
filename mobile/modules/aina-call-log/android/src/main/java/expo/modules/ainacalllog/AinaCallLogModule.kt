// Not `in.ainatech…`: `in` is a Kotlin keyword, and SDK 57 writes every module's
// class name unescaped into the generated Kotlin ExpoModulesPackageList, which
// then fails to compile (EAS build 0d366f8b, 2026-09-29).
package expo.modules.ainacalllog

import android.Manifest
import android.content.pm.PackageManager
import android.provider.CallLog
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AinaCallLogModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AinaCallLog")
    AsyncFunction("readCalls") { since: Double, until: Double ->
      val context = appContext.reactContext ?: throw IllegalStateException("App unavailable")
      if (context.checkSelfPermission(Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
        throw SecurityException("Call log permission is disabled")
      }
      val rows = mutableListOf<Map<String, Any>>()
      val columns = arrayOf(CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.TYPE)
      context.contentResolver.query(CallLog.Calls.CONTENT_URI, columns,
        "${CallLog.Calls.DATE} >= ? AND ${CallLog.Calls.DATE} < ?",
        arrayOf(since.toLong().toString(), until.toLong().toString()), "${CallLog.Calls.DATE} ASC, ${CallLog.Calls._ID} ASC")?.use { cursor ->
        while (cursor.moveToNext() && rows.size < 5000) {
          rows.add(mapOf("id" to cursor.getString(0), "number" to (cursor.getString(1) ?: ""),
            "date" to cursor.getLong(2).toDouble(), "duration" to cursor.getInt(3), "type" to cursor.getInt(4)))
        }
      }
      rows
    }
  }
}
