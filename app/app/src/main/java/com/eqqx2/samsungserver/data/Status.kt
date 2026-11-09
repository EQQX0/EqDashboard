package com.eqqx2.samsungserver.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class Memory(val totalBytes: Long, val freeBytes: Long)

@Serializable
data class Storage(val totalKb: Long, val usedKb: Long, val freeKb: Long)

@Serializable
data class Battery(
    val percentage: Int,
    val temperature: Double,
    val status: String,
    val plugged: String,
)

@Serializable
data class Status(
    val time: String,
    val uptimeSec: Long,
    val load: List<Double>,
    val cpuCores: Int,
    val memory: Memory,
    val storage: Storage? = null,
    val battery: Battery? = null,
)

private val statusJson = Json { ignoreUnknownKeys = true }

fun parseStatus(json: String): Status = statusJson.decodeFromString(Status.serializer(), json)
