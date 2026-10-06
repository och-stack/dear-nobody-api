import { useEffect, useState } from 'react'
import { useAuth } from '../context/login'
import { ENDPOINTS } from '../App'

export default function Friends() {
    const { apiFetch } = useAuth()
    const [users, setUsers] = useState([])
    const [error, setError] = useState('')

    useEffect(() => {
        loadUsers()
    }, [])

    async function loadUsers() {
        try {
            const data = await apiFetch(ENDPOINTS.users)

            setUsers(
                Array.isArray(data)
                    ? data
                    : data.users || []
            )
        } catch (err) {
            setError(err.message)
        }
    }

    async function follow(userId) {
        setError('')

        try {
            await apiFetch(ENDPOINTS.friends, {
                method: 'POST',
                body: JSON.stringify({
                    friend_id: userId,
                }),
            })

            await loadUsers()
        } catch (err) {
            setError(err.message)
        }
    }

    async function acceptFriend(friendshipId) {
        setError('')

        try {
            await apiFetch(
                `${ENDPOINTS.acceptFriend}/${friendshipId}`,
                {
                    method: 'PUT',
                }
            )

            await loadUsers()
        } catch (err) {
            setError(err.message)
        }
    }

    function renderFriendButton(user) {
        if (user.friendship_status === 'accepted') {
            return (
                <button
                    className="btn btn-sm btn-success"
                    disabled
                >
                    Following
                </button>
            )
        }

        if (
            user.friendship_status === 'pending' &&
            user.friendship_direction === 'outgoing'
        ) {
            return (
                <button
                    className="btn btn-sm btn-secondary"
                    disabled
                >
                    Pending
                </button>
            )
        }

        if (
            user.friendship_status === 'pending' &&
            user.friendship_direction === 'incoming'
        ) {
            return (
                <button
                    className="btn btn-sm btn-success"
                    onClick={() => acceptFriend(user.friendship_id)}
                >
                    Accept
                </button>
            )
        }

        return (
            <button
                className="btn btn-sm btn-primary"
                onClick={() => follow(user.id)}
            >
                Follow
            </button>
        )
    }

    return (
        <div className="row justify-content-center">
            <div className="col-lg-8">

                <div className="d-flex align-items-center gap-2 mb-4">
                    <img
                        src="/root.png"
                        alt="Root"
                        width="30"
                        height="30"
                        style={{ objectFit: 'contain' }}
                    />

                    <h1 className="mb-0">
                        Friends
                    </h1>
                </div>

                {error && (
                    <div className="alert alert-danger">
                        {error}
                    </div>
                )}

                <div className="card friends-card shadow-sm">
                    <div className="card-body">
                        <h5 className="card-title mb-3">
                            Meet a Listener
                        </h5>

                        <ul className="list-group list-group-flush friends-list">
                            {users.map((user) => (
                                <li
                                    key={user.id}
                                    className="list-group-item friend-item d-flex justify-content-between align-items-center"
                                >
                                    <span className="friend-name">
                                        {user.username || user.email}
                                    </span>

                                    {renderFriendButton(user)}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

            </div>
        </div>
    )
}
