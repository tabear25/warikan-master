import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Body, Button, Field, Muted, Title } from "@/components/ui";
import { useTheme } from "@/theme";
import { splitYen } from "@/lib/split";
import { formatYen } from "@/lib/currency";
import { SPLIT_MODES, SPLIT_MODE_LABEL, type Member, type Payment, type SplitMode } from "@/lib/types";

const MODE_ICON: Record<SplitMode, React.ComponentProps<typeof Ionicons>["name"]> = {
  equal: "git-compare-outline",
  ratio: "options-outline",
  amount: "cash-outline",
};

export function PaymentModal({
  visible,
  onClose,
  eventId,
  members,
  payment,
}: {
  visible: boolean;
  onClose: () => void;
  eventId: number;
  members: Member[];
  payment?: Payment | null;
}) {
  const { colors } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!payment;

  const [payerId, setPayerId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [weights, setWeights] = useState<Record<number, string>>({});
  const [amounts, setAmounts] = useState<Record<number, string>>({});

  // Initialise when the modal opens (add vs edit).
  useEffect(() => {
    if (!visible) return;
    if (payment) {
      const splitIds: number[] = JSON.parse(payment.splitMemberIds);
      const mode = (payment.splitMode ?? "equal") as SplitMode;
      const detail: Record<string, number> = payment.splitDetails ? JSON.parse(payment.splitDetails) : {};
      setPayerId(payment.payerId);
      setAmount(String(Math.round(payment.amount)));
      setDescription(payment.description);
      setSplitMode(mode);
      setSelectedIds(splitIds);
      setWeights(Object.fromEntries(splitIds.map((id) => [id, String(mode === "ratio" ? detail[String(id)] ?? 1 : 1)])));
      setAmounts(Object.fromEntries(splitIds.map((id) => [id, mode === "amount" ? String(detail[String(id)] ?? "") : ""])));
    } else {
      const allIds = members.map((m) => m.id);
      setPayerId(null);
      setAmount("");
      setDescription("");
      setSplitMode("equal");
      setSelectedIds(allIds);
      setWeights(Object.fromEntries(allIds.map((id) => [id, "1"])));
      setAmounts(Object.fromEntries(allIds.map((id) => [id, ""])));
    }
  }, [visible, payment, members]);

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiJson(
        isEdit ? "PATCH" : "POST",
        isEdit ? `/api/events/${eventId}/payments/${payment!.id}` : `/api/events/${eventId}/payments`,
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event", eventId, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["event", eventId, "settlement"] });
      toast({ title: isEdit ? "支払いを更新しました" : "支払いを追加しました" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "エラー", description: err.message, variant: "destructive" }),
  });

  const toggleMember = (id: number) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const amountNum = Math.round(parseFloat(amount));
  const orderedSelected = members.map((m) => m.id).filter((id) => selectedIds.includes(id));

  // Per-participant preview (integer yen, sums to amount) — same as the server.
  const preview = useMemo<Map<number, number>>(() => {
    if (!Number.isFinite(amountNum) || amountNum <= 0 || orderedSelected.length === 0) return new Map();
    if (splitMode === "equal") return splitYen(amountNum, orderedSelected);
    if (splitMode === "ratio") {
      const w: Record<number, number> = {};
      orderedSelected.forEach((id) => {
        w[id] = Math.max(0, parseFloat(weights[id] ?? "0") || 0);
      });
      return splitYen(amountNum, orderedSelected, w);
    }
    const map = new Map<number, number>();
    orderedSelected.forEach((id) => map.set(id, Math.round(parseFloat(amounts[id] ?? "0") || 0)));
    return map;
  }, [amountNum, orderedSelected, splitMode, weights, amounts]);

  const amountsSum =
    splitMode === "amount"
      ? orderedSelected.reduce((acc, id) => acc + Math.round(parseFloat(amounts[id] ?? "0") || 0), 0)
      : 0;
  const amountsMatch = splitMode !== "amount" || amountsSum === amountNum;

  const handleSubmit = () => {
    if (!payerId || !Number.isFinite(amountNum) || amountNum <= 0 || !description.trim()) {
      toast({ title: "入力が不完全です", description: "すべての項目を入力してください", variant: "destructive" });
      return;
    }
    if (orderedSelected.length === 0) {
      toast({ title: "割り勘対象を選んでください", variant: "destructive" });
      return;
    }
    if (splitMode === "amount" && !amountsMatch) {
      toast({
        title: "内訳が金額と一致しません",
        description: `内訳合計 ¥${amountsSum.toLocaleString("ja-JP")} / 金額 ¥${(amountNum || 0).toLocaleString("ja-JP")}`,
        variant: "destructive",
      });
      return;
    }
    if (splitMode === "ratio" && orderedSelected.every((id) => (parseFloat(weights[id] ?? "0") || 0) <= 0)) {
      toast({ title: "比率を入力してください", variant: "destructive" });
      return;
    }

    const base = {
      payerId,
      amount: amountNum,
      description: description.trim(),
      splitMemberIds: orderedSelected,
      splitMode,
    };
    if (splitMode === "ratio") {
      const w: Record<string, number> = {};
      orderedSelected.forEach((id) => {
        w[String(id)] = Math.max(0, parseFloat(weights[id] ?? "0") || 0);
      });
      mutation.mutate({ ...base, weights: w });
    } else if (splitMode === "amount") {
      const a: Record<string, number> = {};
      orderedSelected.forEach((id) => {
        a[String(id)] = Math.round(parseFloat(amounts[id] ?? "0") || 0);
      });
      mutation.mutate({ ...base, amounts: a });
    } else {
      mutation.mutate(base);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sheetHead}>
            <View>
              <Title>{isEdit ? "支払いを編集" : "支払いを追加"}</Title>
              <Muted>誰が何をいくら払ったか記録します</Muted>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            {/* Payer */}
            <View style={styles.group}>
              <Body style={styles.label}>支払った人</Body>
              <View style={styles.chips}>
                {members.map((m) => {
                  const active = payerId === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setPayerId(m.id)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primary : "transparent",
                          borderColor: active ? colors.primary : colors.input,
                        },
                      ]}
                    >
                      <Body style={{ color: active ? colors.primaryForeground : colors.foreground }}>{m.name}</Body>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Field
              label="金額（円）"
              placeholder="例：3500"
              value={amount}
              onChangeText={setAmount}
              keyboardType="number-pad"
            />
            <Field
              label="説明"
              placeholder="例：夕食代"
              value={description}
              onChangeText={setDescription}
            />

            {/* Split mode */}
            <View style={styles.group}>
              <Body style={styles.label}>割り勘の方法</Body>
              <View style={styles.modeRow}>
                {SPLIT_MODES.map((mode) => {
                  const active = splitMode === mode;
                  return (
                    <Pressable
                      key={mode}
                      onPress={() => setSplitMode(mode)}
                      style={[
                        styles.modeBtn,
                        {
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active ? colors.primary + "1A" : "transparent",
                        },
                      ]}
                    >
                      <Ionicons name={MODE_ICON[mode]} size={16} color={active ? colors.primary : colors.mutedForeground} />
                      <Muted style={{ color: active ? colors.primary : colors.mutedForeground }}>
                        {SPLIT_MODE_LABEL[mode]}
                      </Muted>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Participants */}
            <View style={styles.group}>
              <Body style={styles.label}>割り勘する人</Body>
              {members.map((m) => {
                const checked = selectedIds.includes(m.id);
                const share = preview.get(m.id);
                return (
                  <View key={m.id} style={styles.memberRow}>
                    <Pressable onPress={() => toggleMember(m.id)} style={styles.checkboxRow} hitSlop={6}>
                      <Ionicons
                        name={checked ? "checkbox" : "square-outline"}
                        size={22}
                        color={checked ? colors.primary : colors.mutedForeground}
                      />
                      <Body style={{ flexShrink: 1 }}>{m.name}</Body>
                    </Pressable>
                    {checked && splitMode === "ratio" && (
                      <Field
                        style={styles.smallInput}
                        value={weights[m.id] ?? ""}
                        onChangeText={(v) => setWeights((prev) => ({ ...prev, [m.id]: v }))}
                        keyboardType="number-pad"
                      />
                    )}
                    {checked && splitMode === "amount" && (
                      <Field
                        style={styles.smallInput}
                        placeholder="円"
                        value={amounts[m.id] ?? ""}
                        onChangeText={(v) => setAmounts((prev) => ({ ...prev, [m.id]: v }))}
                        keyboardType="number-pad"
                      />
                    )}
                    {checked && splitMode !== "amount" && share !== undefined && (
                      <Muted style={styles.shareText}>{formatYen(share)}</Muted>
                    )}
                  </View>
                );
              })}
              {splitMode === "amount" && Number.isFinite(amountNum) && amountNum > 0 && (
                <Muted style={{ textAlign: "right", color: amountsMatch ? colors.mutedForeground : colors.destructive }}>
                  内訳合計 ¥{amountsSum.toLocaleString("ja-JP")} / 金額 ¥{amountNum.toLocaleString("ja-JP")}
                  {!amountsMatch && `（差 ¥${Math.abs(amountNum - amountsSum).toLocaleString("ja-JP")}）`}
                </Muted>
              )}
            </View>

            <Button
              title={mutation.isPending ? "保存中..." : isEdit ? "更新する" : "追加する"}
              onPress={handleSubmit}
              loading={mutation.isPending}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    maxHeight: "92%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 },
  form: { gap: 16, paddingBottom: 24, paddingTop: 4 },
  group: { gap: 8 },
  label: { fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  modeRow: { flexDirection: "row", gap: 8 },
  modeBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    gap: 4,
  },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 },
  checkboxRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  smallInput: { width: 80 },
  shareText: { width: 72, textAlign: "right" },
});
