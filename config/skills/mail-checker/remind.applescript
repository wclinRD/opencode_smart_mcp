(*
  remind.applescript — Scan today's important emails and push to Reminders.
  Called by check-email.sh remind
*)

-- Pre-compute all due dates (handler called outside tell blocks)
on makeDate(y, m, d, h, min)
	set dd to current date
	set year of dd to y
	set month of dd to m
	set day of dd to d
	set hours of dd to h
	set minutes of dd to min
	set seconds of dd to 0
	return dd
end makeDate

set d1 to makeDate(2026, 5, 15, 18, 0)
set d2 to makeDate(2026, 5, 14, 8, 0)
set d3 to makeDate(2026, 5, 13, 9, 25)
set d4 to makeDate(2026, 5, 19, 12, 0)
set d5 to makeDate(2026, 5, 15, 12, 0)

-- Helper: extract URL from text
on extractURL(txt)
	set linkStart to offset of "https://" in txt
	if linkStart = 0 then
		set linkStart to offset of "http://" in txt
	end if
	if linkStart > 0 then
		set txtLen to length of txt
		set linkEnd to linkStart
		repeat with i from linkStart to txtLen
			set ch to character i of txt
			if ch is space or ch is return or ch is linefeed or ch is tab then
				set linkEnd to i - 1
				exit repeat
			end if
			set linkEnd to i
		end repeat
		return text linkStart thru linkEnd of txt
	end if
	return ""
end extractURL

-- Helper: truncate text
on truncate(txt, maxLen)
	if length of txt > maxLen then
		return (text 1 thru maxLen of txt) & "..."
	else
		return txt
	end if
end truncate

-- Main
tell application "Mail"
	set todayDate to current date
	set time of todayDate to 0
	
	set importantItems to {}
	
	-- ── SMI account ──
	try
		set acct to account "SMI"
		set mbx to mailbox "收件匣" of acct
		set todayMsgs to (every message of mbx whose date received >= todayDate)
		
		repeat with msg in todayMsgs
			set subj to subject of msg
			set sndr to sender of msg
			set msgId to message id of msg
			set msgLink to "message://%3C" & msgId & "%3E"
			
			if subj contains "lint warning" then
				set msgContent to content of msg
				set end of importantItems to {title:"Review W164 lint warning", sndr:sndr, url:msgLink, summary:"Lint W164 (左右式BIT數不等) Warning，請review各自負責區塊，下次svn update修改", link:"", dueDate:d1}
			end if
			
			if subj contains "職務代理人" then
				set end of importantItems to {title:"職務代理人 - 同事請假 5/14 08:00-12:00", sndr:sndr, url:msgLink, summary:"同事請假 2026/05/14 08:00~12:00 (4小時)，你為職務代理人", link:"", dueDate:d2}
			end if
			
			if subj contains "All Hands" then
				set end of importantItems to {title:"2026/05/13 09:30 All Hands Meeting", sndr:sndr, url:msgLink, summary:"全體同仁需參加 Zoom會議 09:30~11:30", link:"PENDING_ZOOM", dueDate:d3}
			end if
			
			if subj contains "RDFTP" then
				set end of importantItems to {title:"RDFTP 帳號 5/20 到期 - 申請續約", sndr:sndr, url:msgLink, summary:"使用者帳號將於近期到期，需提交RDFTP application續約", link:"", dueDate:d4}
			end if
		end repeat
	end try
	
	-- ── Gmail.US account ──
	try
		set acct2 to account "Gmail.US"
		set mbx2 to mailbox "INBOX" of acct2
		set todayMsgs2 to (every message of mbx2 whose date received >= todayDate)
		
		repeat with msg in todayMsgs2
			set subj to subject of msg
			if subj contains "GitHub" and subj contains "Application" then
				set msgContent to content of msg
				set msgId to message id of msg
				set msgLink to "message://%3C" & msgId & "%3E"
				set reviewLink to my extractURL(msgContent)
				set end of importantItems to {title:"確認 GitHub 第三方應用程式", sndr:sender of msg, url:msgLink, summary:"Amazon Web Services (Builder ID) 已獲授權，權限: 檢視Email地址", link:reviewLink, dueDate:d5}
			end if
		end repeat
	end try
	
	-- ── Find Zoom meeting link ──
	set zoomLink to ""
	set meetingId to ""
	set meetingPwd to ""
	
	try
		set acct to account "SMI"
		set mbx to mailbox "收件匣" of acct
		set weekAgo to (current date) - (7 * 24 * 60 * 60)
		set recentMsgs to (every message of mbx whose date received >= weekAgo)
		
		repeat with msg in recentMsgs
			set subj to subject of msg
			set sndr to sender of msg
			
			if sndr contains "zoom.us" or (subj contains "All-Hands" and subj contains "確認") then
				set msgContent to content of msg
				set zoomLink to my extractURL(msgContent)
				
				set idOffset to offset of "網路研討會ID" in msgContent
				if idOffset > 0 then
					set idLine to text idOffset thru (idOffset + 40) of msgContent
					set meetingId to my truncate(idLine, 30)
				end if
				
				set pwdOffset to offset of "密碼" in msgContent
				if pwdOffset > 0 then
					set pwdLine to text pwdOffset thru (pwdOffset + 20) of msgContent
					set meetingPwd to my truncate(pwdLine, 15)
				end if
			end if
		end repeat
	end try
	
	-- ── Write to Reminders ──
	tell application "Reminders"
		set targetList to list "SMI"
		set allReminders to every reminder of targetList
		repeat with r in allReminders
			delete r
		end repeat
		
		repeat with itemData in importantItems
			set r to make new reminder at end of reminders of targetList
			set name of r to (title of itemData)
			
			set bodyText to "內容: " & (summary of itemData) & return
			set bodyText to bodyText & "寄件人: " & (sndr of itemData) & return
			set bodyText to bodyText & "郵件連結: " & (url of itemData)
			
			if (title of itemData) contains "All Hands" then
				set bodyText to bodyText & return & "會議ID: " & meetingId & return
				set bodyText to bodyText & "密碼: " & meetingPwd & return
				if zoomLink is not "" then
					set bodyText to bodyText & "Zoom連結: " & zoomLink & return
				end if
				set bodyText to bodyText & "IT支援: 請聯繫 IT 部門"
			end if
			
			if (link of itemData) is not "" then
				set bodyText to bodyText & return & "審查連結: " & (link of itemData)
			end if
			
			set body of r to bodyText
			set due date of r to (dueDate of itemData)
		end repeat
		
		set totalCount to length of importantItems
		return "已重建 " & totalCount & " 筆提醒事項（含內容摘要 + 線上連結 + 郵件連結 + 到期日）"
	end tell
end tell
