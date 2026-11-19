const std = @import("std");

const ScanResult = struct {
    prompt_tokens: u64 = 0,
    completion_tokens: u64 = 0,
    context_size: u64 = 0,
    state: u8 = 3,
};

fn integer(value: ?std.json.Value) ?u64 {
    const item = value orelse return null;
    return switch (item) {
        .integer => |number| if (number >= 0) @intCast(number) else null,
        else => null,
    };
}

fn objectInteger(object: std.json.ObjectMap, key: []const u8) ?u64 {
    return integer(object.get(key));
}

fn objectRequest(value: std.json.Value, fallback_context: u64) ?ScanResult {
    const object = switch (value) {
        .object => |item| item,
        else => return null,
    };
    const context = modelContext(object) orelse fallback_context;
    return .{
        .prompt_tokens = objectInteger(object, "promptTokens") orelse 0,
        .completion_tokens = objectInteger(object, "completionTokens") orelse 0,
        .context_size = context,
        .state = requestState(object),
    };
}

fn modelContext(request: std.json.ObjectMap) ?u64 {
    const configuration = request.get("modelConfiguration") orelse return null;
    const object = switch (configuration) {
        .object => |item| item,
        else => return null,
    };
    return objectInteger(object, "contextSize");
}

fn requestState(request: std.json.ObjectMap) u8 {
    const model_state = request.get("modelState") orelse return 3;
    const object = switch (model_state) {
        .object => |item| item,
        else => return 3,
    };
    return @intCast(@min(objectInteger(object, "value") orelse 3, 3));
}

fn selectedContext(root: std.json.Value) u64 {
    const root_object = switch (root) {
        .object => |item| item,
        else => return 0,
    };
    const input_state = root_object.get("inputState") orelse return 0;
    const input_object = switch (input_state) {
        .object => |item| item,
        else => return 0,
    };
    const selected = input_object.get("selectedModel") orelse return 0;
    const selected_object = switch (selected) {
        .object => |item| item,
        else => return 0,
    };
    const metadata = selected_object.get("metadata") orelse return 0;
    const metadata_object = switch (metadata) {
        .object => |item| item,
        else => return 0,
    };
    return objectInteger(metadata_object, "maxInputTokens") orelse 0;
}

fn latestRequest(requests: ?std.json.Value, fallback_context: u64) ?ScanResult {
    const list = requests orelse return null;
    const items = switch (list) {
        .array => |value| value.items,
        else => return null,
    };
    if (items.len == 0) return null;
    return objectRequest(items[items.len - 1], fallback_context);
}

fn pathKind(path: std.json.Value) ?[]const u8 {
    return switch (path) {
        .string => |value| value,
        else => null,
    };
}

fn applyPatch(result: *ScanResult, context_size: *u64, operation: std.json.ObjectMap) void {
    const kind = objectInteger(operation, "kind") orelse return;
    const operation_value = operation.get("v");
    if (kind == 0) {
        if (operation_value) |root| {
            context_size.* = selectedContext(root);
            const root_object = switch (root) {
                .object => |item| item,
                else => return,
            };
            if (latestRequest(root_object.get("requests"), context_size.*)) |latest| result.* = latest;
        }
        return;
    }
    const path = operation.get("k") orelse return;
    const path_items = switch (path) {
        .array => |value| value.items,
        else => return,
    };
    if (path_items.len == 0 or !std.mem.eql(u8, pathKind(path_items[0]) orelse return, "requests")) return;
    if (path_items.len == 1) {
        if (kind == 1) {
            if (latestRequest(operation_value, context_size.*)) |latest| result.* = latest;
        } else if (kind == 2) {
            const insertion = operation_value orelse return;
            if (latestRequest(insertion, context_size.*)) |latest| result.* = latest;
        }
        return;
    }
    if (path_items.len != 3) return;
    const field = pathKind(path_items[2]) orelse return;
    if (std.mem.eql(u8, field, "promptTokens")) result.prompt_tokens = integer(operation_value) orelse result.prompt_tokens;
    if (std.mem.eql(u8, field, "completionTokens")) result.completion_tokens = integer(operation_value) orelse result.completion_tokens;
    if (std.mem.eql(u8, field, "modelState")) {
        const state_value = operation_value orelse return;
        const state_object = switch (state_value) {
            .object => |item| item,
            else => return,
        };
        result.state = @intCast(@min(objectInteger(state_object, "value") orelse 3, 3));
    }
    if (std.mem.eql(u8, field, "modelConfiguration")) {
        const configuration = operation_value orelse return;
        const configuration_object = switch (configuration) {
            .object => |item| item,
            else => return,
        };
        result.context_size = objectInteger(configuration_object, "contextSize") orelse result.context_size;
    }
}

fn scanFile(allocator: std.mem.Allocator, path: []const u8) !ScanResult {
    const bytes = try std.fs.cwd().readFileAlloc(allocator, path, 256 * 1024 * 1024);
    defer allocator.free(bytes);
    var result = ScanResult{};
    var context_size: u64 = 0;
    var lines = std.mem.splitScalar(u8, bytes, '\n');
    while (lines.next()) |raw_line| {
        const line = std.mem.trimEnd(u8, raw_line, "\r \t");
        if (line.len == 0) continue;
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, line, .{}) catch return error.InvalidSession;
        defer parsed.deinit();
        const operation = switch (parsed.value) {
            .object => |item| item,
            else => return error.InvalidSession,
        };
        applyPatch(&result, &context_size, operation);
    }
    if (result.prompt_tokens == 0) return error.MissingPromptTokens;
    return result;
}

fn writeResult(allocator: std.mem.Allocator, result: ScanResult) !void {
    const output = try std.fmt.allocPrint(allocator, "{d}\t{d}\t{d}\t{d}\n", .{
        result.prompt_tokens,
        result.completion_tokens,
        result.context_size,
        result.state,
    });
    defer allocator.free(output);
    try std.fs.File.stdout().writeAll(output);
}

pub fn main() !void {
    var allocator_state = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = allocator_state.deinit();
    const allocator = allocator_state.allocator();
    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);
    if (args.len != 2) return error.InvalidArguments;
    try writeResult(allocator, try scanFile(allocator, args[1]));
}
